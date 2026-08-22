/**
 * Auth — pairing codes, token generation, constant-time compare, rate limiting.
 *
 * Security requirements from specs.md R3.2:
 * - 6-digit pairing code, expires in 10 minutes
 * - Bearer token ≥32 bytes CSPRNG, hex-encoded
 * - Rate limit: 5 failed attempts per IP in 60s → block for 5 minutes
 * - Constant-time comparison
 *
 * Tokens are persisted to ~/.aibou/config.json (context.md §7) so a paired
 * phone or watch survives a Bridge restart. Without this, every restart
 * silently forces every client to re-pair.
 */

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
  blockedUntil: number;
}

/** On-disk shape of ~/.aibou/config.json. */
interface StoredConfig {
  version: 1;
  tokens: string[];
}

export interface AuthManagerOptions {
  /**
   * Where to persist issued tokens. Pass null to disable persistence entirely
   * (used by tests so they never touch the developer's home directory).
   */
  configPath?: string | null;
}

/** Cap stored tokens so pairing repeatedly cannot grow the file without bound. */
const MAX_STORED_TOKENS = 20;

export class AuthManager {
  private pairingCode: string;
  private codeExpiresAt: number;
  private tokens = new Set<string>();
  private rateLimits = new Map<string, RateLimitEntry>();
  private readonly configPath: string | null;

  private readonly CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds
  private readonly RATE_LIMIT_MAX_ATTEMPTS = 5;
  private readonly RATE_LIMIT_BLOCK_MS = 5 * 60 * 1000; // 5 minutes

  constructor(options: AuthManagerOptions = {}) {
    this.configPath =
      options.configPath === undefined
        ? join(homedir(), '.aibou', 'config.json')
        : options.configPath;

    this.pairingCode = this.generateCode();
    this.codeExpiresAt = Date.now() + this.CODE_TTL_MS;
    this.loadTokens();
  }

  /** Number of tokens currently trusted, for startup reporting. */
  get knownTokenCount(): number {
    return this.tokens.size;
  }

  /** Forget every issued token, forcing all clients to pair again. */
  revokeAllTokens(): void {
    this.tokens.clear();
    this.persistTokens();
  }

  /**
   * Load previously issued tokens. A missing or unreadable file simply means
   * no client is paired yet — never fatal.
   */
  private loadTokens(): void {
    if (!this.configPath || !existsSync(this.configPath)) return;

    try {
      const raw = readFileSync(this.configPath, 'utf-8').replace(/^\uFEFF/, '');
      const parsed: unknown = JSON.parse(raw);

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray((parsed as StoredConfig).tokens)
      ) {
        console.warn(`[auth] ${this.configPath} is malformed; ignoring stored tokens.`);
        return;
      }

      // Only accept values shaped like tokens we would have issued.
      for (const t of (parsed as StoredConfig).tokens) {
        if (typeof t === 'string' && /^[0-9a-f]{64}$/.test(t)) {
          this.tokens.add(t);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[auth] Could not read ${this.configPath}: ${message}. Ignoring stored tokens.`);
    }
  }

  /** Write tokens back to disk with owner-only permissions where supported. */
  private persistTokens(): void {
    if (!this.configPath) return;

    try {
      mkdirSync(dirname(this.configPath), { recursive: true });

      // Keep only the most recent tokens.
      const tokens = [...this.tokens].slice(-MAX_STORED_TOKENS);
      this.tokens = new Set(tokens);

      const config: StoredConfig = { version: 1, tokens };
      writeFileSync(this.configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

      // No-op on Windows, meaningful on POSIX.
      try {
        chmodSync(this.configPath, 0o600);
      } catch {
        /* filesystem does not support POSIX modes */
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[auth] Could not persist tokens to ${this.configPath}: ${message}. ` +
          `Clients will need to re-pair after a restart.`,
      );
    }
  }

  /**
   * Get the current pairing code (for display to user).
   */
  getPairingCode(): string {
    return this.pairingCode;
  }

  /**
   * Get the pairing URL for QR code generation.
   */
  getPairingUrl(host: string, port: number): string {
    return `http://${host}:${port}/pair?code=${this.pairingCode}`;
  }

  /**
   * Regenerate the pairing code (e.g., on SIGHUP or --repair).
   */
  regenerateCode(): string {
    this.pairingCode = this.generateCode();
    this.codeExpiresAt = Date.now() + this.CODE_TTL_MS;
    return this.pairingCode;
  }

  /**
   * Validate a pairing code and issue a token.
   * Returns the token on success, null on failure.
   */
  pair(code: string, clientIp: string): string | null {
    // Check rate limit
    if (this.isRateLimited(clientIp)) {
      return null;
    }

    // Check expiry
    if (Date.now() > this.codeExpiresAt) {
      this.recordFailedAttempt(clientIp);
      return null;
    }

    // Constant-time comparison (AC3.2.7)
    if (!this.constantTimeCompare(code, this.pairingCode)) {
      this.recordFailedAttempt(clientIp);
      return null;
    }

    // Issue token
    const token = randomBytes(32).toString('hex'); // 64 hex chars = 32 bytes
    this.tokens.add(token);
    // Persist so this client stays paired across Bridge restarts (context.md §7)
    this.persistTokens();
    return token;
  }

  /**
   * Validate a bearer token. Constant-time comparison.
   */
  validateToken(token: string): boolean {
    // We need to check against all stored tokens with constant-time compare
    for (const stored of this.tokens) {
      if (this.constantTimeCompare(token, stored)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if an IP is currently rate-limited.
   */
  isRateLimited(ip: string): boolean {
    const entry = this.rateLimits.get(ip);
    if (!entry) return false;

    // Check if block is still active
    if (entry.blockedUntil > Date.now()) {
      return true;
    }

    // Check if window has expired, reset if so
    if (Date.now() - entry.firstAttempt > this.RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.delete(ip);
      return false;
    }

    return false;
  }

  private recordFailedAttempt(ip: string): void {
    const entry = this.rateLimits.get(ip);
    const now = Date.now();

    if (!entry || now - entry.firstAttempt > this.RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.set(ip, {
        attempts: 1,
        firstAttempt: now,
        blockedUntil: 0,
      });
      return;
    }

    entry.attempts++;
    if (entry.attempts >= this.RATE_LIMIT_MAX_ATTEMPTS) {
      entry.blockedUntil = now + this.RATE_LIMIT_BLOCK_MS;
    }
  }

  private generateCode(): string {
    // 6-digit numeric code
    return String(randomInt(100000, 999999));
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      // Still do a comparison to avoid timing leak on length
      const dummy = Buffer.alloc(a.length, 0);
      timingSafeEqual(dummy, dummy);
      return false;
    }
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');
    return timingSafeEqual(bufA, bufB);
  }
}
