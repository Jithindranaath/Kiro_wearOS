import { describe, it, expect } from 'vitest';
import { AuthManager } from './auth.js';

const IP = '192.168.1.50';

describe('AuthManager — pairing codes', () => {
  it('generates a 6-digit numeric code', () => {
    const a = new AuthManager();
    expect(a.getPairingCode()).toMatch(/^\d{6}$/);
  });

  it('generates different codes across instances', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 25; i++) codes.add(new AuthManager().getPairingCode());
    // Collisions are possible but 25 identical codes would mean it is not random
    expect(codes.size).toBeGreaterThan(1);
  });

  it('regenerates a fresh code on demand (AC3.2.3)', () => {
    const a = new AuthManager();
    const first = a.getPairingCode();
    const second = a.regenerateCode();
    expect(second).toMatch(/^\d{6}$/);
    expect(a.getPairingCode()).toBe(second);
    // Old code must no longer pair
    expect(a.pair(first, IP)).toBeNull();
  });

  it('builds a pairing URL containing the code', () => {
    const a = new AuthManager();
    const url = a.getPairingUrl('localhost', 8787);
    expect(url).toContain('localhost:8787');
    expect(url).toContain(a.getPairingCode());
  });
});

describe('AuthManager — token issuance', () => {
  it('issues a 64-char hex token for a valid code (AC3.2.2)', () => {
    const a = new AuthManager();
    const token = a.pair(a.getPairingCode(), IP);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an incorrect code', () => {
    const a = new AuthManager();
    const wrong = a.getPairingCode() === '000000' ? '111111' : '000000';
    expect(a.pair(wrong, IP)).toBeNull();
  });

  it('rejects codes of the wrong length without throwing', () => {
    const a = new AuthManager();
    for (const bad of ['', '1', '12345', '1234567', 'abcdef']) {
      expect(() => a.pair(bad, IP)).not.toThrow();
      expect(a.pair(bad, IP)).toBeNull();
    }
  });

  it('issues a distinct token each time', () => {
    const a = new AuthManager();
    const code = a.getPairingCode();
    const t1 = a.pair(code, '10.0.0.1');
    const t2 = a.pair(code, '10.0.0.2');
    expect(t1).not.toBe(t2);
  });

  it('validates issued tokens and rejects others', () => {
    const a = new AuthManager();
    const token = a.pair(a.getPairingCode(), IP)!;
    expect(a.validateToken(token)).toBe(true);
    expect(a.validateToken('f'.repeat(64))).toBe(false);
    expect(a.validateToken('')).toBe(false);
    expect(a.validateToken('short')).toBe(false);
  });

  it('keeps earlier tokens valid after re-pairing', () => {
    const a = new AuthManager();
    const code = a.getPairingCode();
    const first = a.pair(code, '10.0.0.1')!;
    const second = a.pair(code, '10.0.0.2')!;
    expect(a.validateToken(first)).toBe(true);
    expect(a.validateToken(second)).toBe(true);
  });
});

describe('AuthManager — rate limiting (AC3.2.4)', () => {
  it('blocks an IP after 5 failures inside the window', () => {
    const a = new AuthManager();
    const ip = '203.0.113.9';
    const wrong = a.getPairingCode() === '000000' ? '111111' : '000000';

    expect(a.isRateLimited(ip)).toBe(false);
    for (let i = 0; i < 5; i++) a.pair(wrong, ip);
    expect(a.isRateLimited(ip)).toBe(true);
  });

  it('refuses even the correct code while an IP is blocked', () => {
    const a = new AuthManager();
    const ip = '203.0.113.10';
    const code = a.getPairingCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) a.pair(wrong, ip);
    expect(a.pair(code, ip)).toBeNull();
  });

  it('limits per IP, not globally', () => {
    const a = new AuthManager();
    const code = a.getPairingCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) a.pair(wrong, '203.0.113.11');
    expect(a.isRateLimited('203.0.113.11')).toBe(true);
    expect(a.isRateLimited('203.0.113.12')).toBe(false);
    expect(a.pair(code, '203.0.113.12')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not block after fewer than 5 failures', () => {
    const a = new AuthManager();
    const ip = '203.0.113.13';
    const code = a.getPairingCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i++) a.pair(wrong, ip);
    expect(a.isRateLimited(ip)).toBe(false);
    expect(a.pair(code, ip)).toMatch(/^[0-9a-f]{64}$/);
  });
});
