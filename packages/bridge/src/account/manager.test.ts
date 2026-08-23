/**
 * AccountManager tests.
 *
 * The manager shells out to kiro-cli, so these drive it against small fake
 * binaries rather than the real CLI: signing the developer out mid-test to prove
 * sign-out works would be unacceptable, and the real device flow needs a human.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountManager } from './manager.js';

let dir: string;

/**
 * Write a Node script that impersonates kiro-cli, and return a command that runs
 * it. Using process.execPath keeps this portable across shells and platforms.
 */
function fakeCli(name: string, body: string): string {
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, body, { mode: 0o755 });
  try {
    chmodSync(file, 0o755);
  } catch {
    /* Windows */
  }
  return file;
}

/**
 * Point the manager at a fake CLI.
 *
 * Runs it as `node <script>` via kiroArgs, which avoids shell-script shims —
 * Windows cannot spawn a .cmd without a shell, and enabling one would change
 * how production quotes its arguments.
 */
function managerFor(script: string, mock = false): AccountManager {
  return new AccountManager({ kiroBin: process.execPath, kiroArgs: [script], mock });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'aibou-account-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('AccountManager — mock mode', () => {
  it('never reports a signed-in user for the fake agent', async () => {
    const manager = new AccountManager({ kiroBin: 'kiro-cli', mock: true });
    const info = await manager.refresh();

    expect(info.state).toBe('mock');
    expect(info.email).toBeUndefined();
    expect(info.reason).toMatch(/fake agent/i);
  });

  it('treats mock as usable so prompts are not blocked', () => {
    const manager = new AccountManager({ kiroBin: 'kiro-cli', mock: true });
    expect(manager.isAuthenticated).toBe(true);
  });

  it('refuses to pretend a sign-in happened', async () => {
    const manager = new AccountManager({ kiroBin: 'kiro-cli', mock: true });
    const info = await manager.login({ social: 'google' });

    expect(info.state).toBe('mock');
    expect(info.email).toBeUndefined();
  });

  it('has nothing to sign out of', async () => {
    const manager = new AccountManager({ kiroBin: 'kiro-cli', mock: true });
    const info = await manager.logout();
    expect(info.state).toBe('mock');
  });
});

describe('AccountManager — reading whoami', () => {
  it('parses the real shape kiro-cli 2.18.1 emits', async () => {
    const script = fakeCli(
      'ok',
      `console.log(JSON.stringify({accountType:"Social",provider:"Google",email:"a@b.com"}));`,
    );
    const info = await managerFor(script).refresh();

    expect(info.state).toBe('authenticated');
    expect(info.email).toBe('a@b.com');
    expect(info.provider).toBe('Google');
    expect(info.accountType).toBe('Social');
  });

  it('tolerates a banner printed before the JSON', async () => {
    const script = fakeCli(
      'banner',
      `console.log("Checking for updates...");console.log(JSON.stringify({email:"c@d.com"}));`,
    );
    const info = await managerFor(script).refresh();

    expect(info.state).toBe('authenticated');
    expect(info.email).toBe('c@d.com');
  });

  it('reports unauthenticated on a non-zero exit', async () => {
    const script = fakeCli('signedout', `console.error("Not logged in");process.exit(1);`);
    const info = await managerFor(script).refresh();

    expect(info.state).toBe('unauthenticated');
    expect(info.email).toBeUndefined();
  });

  it('reports unauthenticated rather than inventing a user from junk output', async () => {
    const script = fakeCli('junk', `console.log("not json at all");`);
    const info = await managerFor(script).refresh();

    expect(info.state).toBe('unauthenticated');
  });

  it('reports unauthenticated when the JSON carries no identity', async () => {
    const script = fakeCli('empty', `console.log(JSON.stringify({}));`);
    const info = await managerFor(script).refresh();

    expect(info.state).toBe('unauthenticated');
  });

  it('drops blank fields instead of surfacing empty strings', async () => {
    const script = fakeCli(
      'blank',
      `console.log(JSON.stringify({email:"  ",provider:"Google"}));`,
    );
    const info = await managerFor(script).refresh();

    expect(info.state).toBe('authenticated');
    expect(info.email).toBeUndefined();
    expect(info.provider).toBe('Google');
  });

  it('reports unavailable when the binary cannot be run', async () => {
    const manager = new AccountManager({
      kiroBin: join(dir, 'definitely-not-here'),
      mock: false,
    });
    const info = await manager.refresh();

    expect(info.state).toBe('unavailable');
    expect(info.reason).toMatch(/AIBOU_KIRO_BIN|Could not run/i);
  });

  it('announces every change so clients stay in step', async () => {
    const script = fakeCli('evt', `console.log(JSON.stringify({email:"e@f.com"}));`);
    const manager = managerFor(script);

    const seen: string[] = [];
    manager.on('changed', (info) => seen.push(info.state));

    await manager.refresh();
    expect(seen).toContain('authenticated');
  });
});

describe('AccountManager — noticing changes made outside Aibou', () => {
  /**
   * The bug this guards: the first reading used to be cached forever, so signing
   * in with `kiro-cli login` left every client insisting nobody was signed in.
   */
  it('picks up a sign-in that happened outside Aibou', async () => {
    // Signed out until the marker file appears, then signed in.
    const marker = join(dir, 'signed-in.marker');
    // ESM: these fakes are .mjs, so `require` is unavailable.
    const script = fakeCli(
      'external-signin',
      `import { existsSync } from "node:fs";
       if(!existsSync(${JSON.stringify(marker)})){process.exit(1);}
       console.log(JSON.stringify({email:"later@signin.com",provider:"Google"}));`,
    );
    const manager = managerFor(script);

    expect((await manager.refresh()).state).toBe('unauthenticated');

    // The developer signs in with the CLI directly.
    writeFileSync(marker, 'yes');

    manager.startWatching();
    try {
      const seen = await new Promise<string>((resolve) => {
        manager.on('changed', (info) => {
          if (info.state === 'authenticated') resolve(String(info.email));
        });
      });
      expect(seen).toBe('later@signin.com');
    } finally {
      manager.stopWatching();
    }
  }, 30_000);

  it('does not re-announce an unchanged account on every poll', async () => {
    const script = fakeCli('stable', `console.log(JSON.stringify({email:"same@user.com"}));`);
    const manager = managerFor(script);

    let announcements = 0;
    manager.on('changed', () => announcements++);

    await manager.refresh();
    expect(announcements).toBe(1);

    // Repeated identical readings must stay quiet, or every watch would receive
    // a redundant frame on every cycle forever.
    await manager.refresh();
    await manager.refresh();
    expect(announcements).toBe(1);
  });

  it('re-reads before reporting that nobody is signed in', async () => {
    const marker = join(dir, 'verify.marker');
    const script = fakeCli(
      'verify-fresh',
      `import { existsSync } from "node:fs";
       if(!existsSync(${JSON.stringify(marker)})){process.exit(1);}
       console.log(JSON.stringify({email:"fresh@check.com"}));`,
    );
    const manager = managerFor(script);

    expect(await manager.verifyAuthenticated()).toBe(false);

    writeFileSync(marker, 'yes');

    // The cache still says signed out; verifyAuthenticated must not trust it.
    expect(manager.isAuthenticated).toBe(false);
    expect(await manager.verifyAuthenticated()).toBe(true);
  });

  it('stops polling when asked', async () => {
    const script = fakeCli('pollstop', `process.exit(1);`);
    const manager = managerFor(script);

    manager.startWatching();
    manager.stopWatching();

    // Nothing should be scheduled; if a timer leaked, vitest would hang here.
    await new Promise((r) => setTimeout(r, 200));
    expect(manager.snapshot.state).toBe('unauthenticated');
  });

  it('never polls in mock mode', () => {
    const manager = new AccountManager({ kiroBin: 'kiro-cli', mock: true });
    manager.startWatching();
    // No CLI exists to poll, and there is no account to notice changing.
    expect(manager.snapshot.state).toBe('mock');
    manager.stopWatching();
  });
});

describe('AccountManager — sign out', () => {
  it('reports unauthenticated after the CLI signs out', async () => {
    // Exits 0 for `logout`, then non-zero for the follow-up `whoami`.
    const script = fakeCli(
      'logout',
      `const args=process.argv.slice(2);
       if(args[0]==="logout"){process.exit(0);}
       process.exit(1);`,
    );
    const info = await managerFor(script).logout();

    expect(info.state).toBe('unauthenticated');
  });

  it('treats an already-signed-out CLI as success', async () => {
    // `logout` fails, but `whoami` confirms nobody is signed in.
    const script = fakeCli(
      'logout-fails',
      `const args=process.argv.slice(2);
       if(args[0]==="logout"){console.error("no active session");process.exit(1);}
       process.exit(1);`,
    );
    const info = await managerFor(script).logout();

    expect(info.state).toBe('unauthenticated');
    expect(info.reason).toBeUndefined();
  });

  it('surfaces a real failure when the account is still signed in afterwards', async () => {
    const script = fakeCli(
      'logout-broken',
      `const args=process.argv.slice(2);
       if(args[0]==="logout"){console.error("boom");process.exit(1);}
       console.log(JSON.stringify({email:"still@here.com"}));`,
    );
    const info = await managerFor(script).logout();

    expect(info.state).toBe('authenticated');
    expect(info.email).toBe('still@here.com');
    expect(info.reason).toMatch(/Sign-out failed/i);
  });
});

describe('AccountManager — device flow', () => {
  it('relays the verification URL and user code as they are printed', async () => {
    // Prints a code for `login`, then answers `whoami` as a signed-in CLI, which
    // is the sequence the manager relies on to confirm the flow worked.
    const script = fakeCli(
      'device',
      `const args=process.argv.slice(2);
       if(args[0]==="login"){
         console.log("Open https://device.sso.example.com/ and enter ABCD-EFGH");
         process.exit(0);
       }
       console.log(JSON.stringify({email:"dev@flow.com",provider:"Google"}));`,
    );

    const manager = managerFor(script);
    const seen: Array<Record<string, unknown>> = [];
    manager.on('changed', (info) => seen.push({ ...info }));

    const final = await manager.login({ social: 'google' });

    const authenticating = seen.filter((s) => s.state === 'authenticating');
    expect(authenticating.length).toBeGreaterThan(0);
    const withCode = authenticating.find((s) => s.userCode === 'ABCD-EFGH');
    expect(withCode).toBeDefined();
    expect(String(withCode?.verificationUri)).toMatch(/^https:\/\/device\.sso\.example\.com/);

    expect(final.state).toBe('authenticated');
    expect(final.email).toBe('dev@flow.com');
  });

  it('asks the CLI rather than assuming a completed flow succeeded', async () => {
    const script = fakeCli(
      'device-abandoned',
      `const args=process.argv.slice(2);
       if(args[0]==="login"){console.log("https://example.com CODE-HERE");process.exit(0);}
       process.exit(1);`,
    );
    const info = await managerFor(script).login();

    // The flow ended, but nobody confirmed it, so no account.
    expect(info.state).toBe('unauthenticated');
  });

  it('cancelling leaves credentials alone and clears the in-flight state', async () => {
    const script = fakeCli(
      'device-cancel',
      `const args=process.argv.slice(2);
       if(args[0]==="login"){console.log("https://example.com AAAA-BBBB");setInterval(()=>{},1000);}
       else {process.exit(1);}`,
    );
    const manager = managerFor(script);

    const flow = manager.login();
    // Give the child a moment to print its code.
    await new Promise((r) => setTimeout(r, 400));
    expect(manager.snapshot.state).toBe('authenticating');

    manager.cancelLogin();
    await flow;

    expect(manager.snapshot.state).toBe('unauthenticated');
  });
});
