/**
 * Account Manager — the Kiro identity the agent runs as.
 *
 * This is the only file that knows how `kiro-cli` exposes authentication, in the
 * same spirit as acp/methods.ts owning ACP's shape. Verified against
 * kiro-cli 2.18.1:
 *
 *   kiro-cli whoami --format json
 *     → {"accountType":"Social","provider":"Google","email":"a@b.com"}, exit 0
 *     → non-zero exit when signed out
 *   kiro-cli login --use-device-flow [--social google|github] [--license free|pro]
 *     → prints a verification URL and a user code, then blocks until confirmed
 *   kiro-cli logout
 *
 * Nothing here is synthesised. If the CLI reports no email, none is emitted —
 * clients render an absence rather than a guess (context.md §6).
 */

import { EventEmitter } from 'node:events';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { AccountState } from '@aibou/protocol';

export interface AccountInfo {
  state: AccountState;
  accountType?: string;
  provider?: string;
  email?: string;
  verificationUri?: string;
  userCode?: string;
  reason?: string;
}

export interface AccountManagerOptions {
  /** Path to the kiro-cli binary. */
  kiroBin: string;
  /**
   * Arguments to place before the subcommand.
   *
   * Lets the binary be an interpreter plus a script, the same way the Bridge
   * launches the bundled mock agent as `node <script>`. Normally empty.
   */
  kiroArgs?: string[];
  /** True when the bundled fake agent is in use, so no real account applies. */
  mock: boolean;
}

/** Shape of `kiro-cli whoami --format json`. All fields are optional by design. */
interface WhoamiJson {
  accountType?: unknown;
  provider?: unknown;
  email?: unknown;
}

/** How long to allow a `whoami` / `logout` call before giving up. */
const CLI_TIMEOUT_MS = 15_000;

/** Device-flow codes are short-lived; do not let a stale attempt linger. */
const LOGIN_TIMEOUT_MS = 5 * 60_000;

/**
 * How often to re-read the account.
 *
 * Signing in or out with the CLI directly is normal and happens outside Aibou
 * entirely, so a cached reading goes stale with no event to tell us. Poll
 * quickly while signed out, because the developer is most likely signing in
 * right then and wants the watch to catch up; poll slowly once signed in, where
 * the only thing to notice is an external sign-out.
 */
const POLL_WHILE_SIGNED_OUT_MS = 10_000;
const POLL_WHILE_SIGNED_IN_MS = 120_000;

export class AccountManager extends EventEmitter {
  private readonly kiroBin: string;
  private readonly kiroArgs: string[];
  private readonly mock: boolean;

  private current: AccountInfo;
  private loginProc: ChildProcess | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private watching = false;

  constructor(options: AccountManagerOptions) {
    super();
    this.kiroBin = options.kiroBin;
    this.kiroArgs = options.kiroArgs ?? [];
    this.mock = options.mock;
    this.current = this.mock
      ? { state: 'mock', reason: 'The bundled fake agent is in use; no Kiro account is involved.' }
      : { state: 'unauthenticated' };
  }

  /** Last known account state. Cheap; does not shell out. */
  get snapshot(): AccountInfo {
    return { ...this.current };
  }

  /** True when a prompt can realistically succeed, per the cached reading. */
  get isAuthenticated(): boolean {
    return this.current.state === 'authenticated' || this.current.state === 'mock';
  }

  /**
   * Re-read the account before answering, so a stale cache can never be the
   * reason a valid prompt is refused.
   */
  async verifyAuthenticated(): Promise<boolean> {
    if (this.isAuthenticated) return true;
    const info = await this.refresh();
    return info.state === 'authenticated' || info.state === 'mock';
  }

  /**
   * Begin polling the CLI so sign-in and sign-out performed outside Aibou are
   * picked up. Without this the first reading is cached forever: signing in with
   * `kiro-cli login` would leave every client insisting nobody is signed in.
   */
  startWatching(): void {
    if (this.watching || this.mock) return;
    this.watching = true;
    this.scheduleNextPoll();
  }

  /** Stop polling. */
  stopWatching(): void {
    this.watching = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private scheduleNextPoll(): void {
    if (!this.watching) return;

    const delay =
      this.current.state === 'authenticated' ? POLL_WHILE_SIGNED_IN_MS : POLL_WHILE_SIGNED_OUT_MS;

    this.pollTimer = setTimeout(() => {
      // A sign-in in progress owns the state; refresh() already defers to it.
      void this.refresh()
        .catch(() => undefined)
        .finally(() => this.scheduleNextPoll());
    }, delay);

    // Never hold the process open just to poll.
    this.pollTimer.unref?.();
  }

  /**
   * Ask the CLI who is signed in and cache the answer.
   *
   * A non-zero exit is the normal signed-out signal, not a fault, so it is
   * reported as `unauthenticated` rather than raised.
   */
  async refresh(): Promise<AccountInfo> {
    if (this.mock) {
      return this.publish({
        state: 'mock',
        reason: 'The bundled fake agent is in use; no Kiro account is involved.',
      });
    }

    // A sign-in in progress must not be clobbered by a poll that races it.
    if (this.current.state === 'authenticating' && this.loginProc !== null) {
      return this.snapshot;
    }

    let stdout: string;
    try {
      stdout = await this.run(['whoami', '--format', 'json']);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Distinguish "signed out" from "the binary is not usable at all".
      if (/ENOENT|not recognized|cannot find/i.test(message)) {
        return this.publish({
          state: 'unavailable',
          reason: `Could not run ${this.kiroBin}. Set AIBOU_KIRO_BIN to its full path.`,
        });
      }
      return this.publish({ state: 'unauthenticated' });
    }

    const parsed = this.parseWhoami(stdout);
    if (!parsed) return this.publish({ state: 'unauthenticated' });

    return this.publish({ state: 'authenticated', ...parsed });
  }

  /**
   * Start the OAuth device flow.
   *
   * The CLI blocks until the developer confirms in a browser, printing a
   * verification URL and user code first. Those are relayed as they appear so a
   * remote client can display them; the promise resolves when the flow ends.
   */
  async login(options: {
    license?: 'free' | 'pro';
    social?: 'google' | 'github';
    identityProvider?: string;
    region?: string;
  } = {}): Promise<AccountInfo> {
    if (this.mock) {
      return this.publish({
        state: 'mock',
        reason: 'Sign-in does not apply in mock mode. Restart the Bridge without --mock.',
      });
    }
    if (this.loginProc !== null) {
      // Already waiting on the developer; resurface the existing code.
      return this.snapshot;
    }

    const args = [...this.kiroArgs, 'login', '--use-device-flow'];
    if (options.license) args.push('--license', options.license);
    if (options.social) args.push('--social', options.social);
    if (options.identityProvider) args.push('--identity-provider', options.identityProvider);
    if (options.region) args.push('--region', options.region);

    this.publish({ state: 'authenticating' });

    return new Promise<AccountInfo>((resolve) => {
      const proc = spawn(this.kiroBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.loginProc = proc;

      let buffered = '';
      const onChunk = (chunk: Buffer): void => {
        buffered += chunk.toString();
        const found = this.parseDeviceFlow(buffered);
        if (found) {
          this.publish({ state: 'authenticating', ...found });
        }
      };

      proc.stdout?.on('data', onChunk);
      proc.stderr?.on('data', onChunk);

      const timer = setTimeout(() => {
        // Codes expire; leaving this running would keep clients staring at a
        // code that no longer works.
        proc.kill();
      }, LOGIN_TIMEOUT_MS);

      const finish = async (): Promise<void> => {
        clearTimeout(timer);
        this.loginProc = null;
        // The CLI is the authority on whether it worked; ask rather than assume.
        resolve(await this.refresh());
      };

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.loginProc = null;
        resolve(
          this.publish({
            state: 'unavailable',
            reason: `Could not start sign-in: ${err.message}`,
          }),
        );
      });

      proc.on('close', () => {
        void finish();
      });
    });
  }

  /** Abandon an in-flight sign-in. Does not touch stored credentials. */
  cancelLogin(): AccountInfo {
    if (this.loginProc !== null) {
      this.loginProc.kill();
      this.loginProc = null;
    }
    if (this.current.state === 'authenticating') {
      this.publish({ state: 'unauthenticated' });
    }
    return this.snapshot;
  }

  /**
   * Sign out.
   *
   * Kiro persists credentials on disk, so this is the only thing that ends the
   * session — restarting the Bridge or the watch does not. Device pairing is
   * untouched: signing out of Kiro must not force a watch to pair again.
   */
  async logout(): Promise<AccountInfo> {
    if (this.mock) {
      return this.publish({
        state: 'mock',
        reason: 'Nothing to sign out of in mock mode.',
      });
    }

    this.cancelLogin();

    try {
      await this.run(['logout']);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Already signed out is a success from the caller's point of view, so
      // confirm with the CLI instead of surfacing a spurious failure.
      const after = await this.refresh();
      if (after.state === 'unauthenticated') return after;
      return this.publish({ ...after, reason: `Sign-out failed: ${message}` });
    }

    return this.refresh();
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  /** Run the CLI and resolve its stdout, rejecting on non-zero exit. */
  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.kiroBin,
        [...this.kiroArgs, ...args],
        { timeout: CLI_TIMEOUT_MS, windowsHide: true },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        },
      );
    });
  }

  /** Extract account fields from `whoami --format json`, tolerating noise. */
  private parseWhoami(stdout: string): Omit<AccountInfo, 'state'> | null {
    // Strip anything before the JSON object; some builds print a banner first.
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start === -1 || end <= start) return null;

    let parsed: WhoamiJson;
    try {
      parsed = JSON.parse(stdout.slice(start, end + 1)) as WhoamiJson;
    } catch {
      return null;
    }

    const str = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

    const email = str(parsed.email);
    const accountType = str(parsed.accountType);
    const provider = str(parsed.provider);

    // No identifying field at all means the CLI told us nothing useful.
    if (!email && !accountType && !provider) return null;

    return { email, accountType, provider };
  }

  /**
   * Pull the verification URL and user code out of the device-flow output.
   *
   * Wording is not contractual, so match on shape — a URL and a code-like token —
   * rather than on a fixed sentence.
   */
  private parseDeviceFlow(text: string): { verificationUri?: string; userCode?: string } | null {
    const uri = /(https?:\/\/[^\s"'<>]+)/.exec(text)?.[1];
    // Device codes are short, upper-case, often hyphenated: ABCD-EFGH.
    const code = /\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/.exec(text)?.[1];

    if (!uri && !code) return null;
    return { verificationUri: uri, userCode: code };
  }

  /**
   * Store a new account state, announcing it only when something actually
   * changed. Polling would otherwise broadcast an identical frame to every
   * connected watch on every cycle, forever.
   */
  private publish(info: AccountInfo): AccountInfo {
    const changed =
      this.current.state !== info.state ||
      this.current.email !== info.email ||
      this.current.provider !== info.provider ||
      this.current.accountType !== info.accountType ||
      this.current.verificationUri !== info.verificationUri ||
      this.current.userCode !== info.userCode ||
      this.current.reason !== info.reason;

    this.current = info;
    if (changed) this.emit('changed', this.snapshot);
    return this.snapshot;
  }
}
