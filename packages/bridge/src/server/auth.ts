/**
 * Auth — pairing codes, token generation, constant-time compare, rate limiting.
 *
 * Security requirements from specs.md R3.2:
 * - 6-digit pairing code, expires in 10 minutes
 * - Bearer token ≥32 bytes CSPRNG, hex-encoded
 * - Rate limit: 5 failed attempts per IP in 60s → block for 5 minutes
 * - Constant-time comparison
 */

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
  blockedUntil: number;
}

export class AuthManager {
  private pairingCode: string;
  private codeExpiresAt: number;
  private tokens = new Set<string>();
  private rateLimits = new Map<string, RateLimitEntry>();

  private readonly CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly RATE_LIMIT_WINDOW_MS = 60_000; // 60 seconds
  private readonly RATE_LIMIT_MAX_ATTEMPTS = 5;
  private readonly RATE_LIMIT_BLOCK_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.pairingCode = this.generateCode();
    this.codeExpiresAt = Date.now() + this.CODE_TTL_MS;
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
