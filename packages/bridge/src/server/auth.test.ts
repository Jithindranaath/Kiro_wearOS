import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthManager } from './auth.js';

const IP = '192.168.1.50';

/**
 * Every AuthManager here disables persistence (configPath: null) unless the test
 * is specifically about persistence, so the suite never reads or writes the
 * developer's ~/.aibou/config.json.
 */
function newAuth(): AuthManager {
  return new AuthManager({ configPath: null });
}

describe('AuthManager — pairing codes', () => {
  it('generates a 6-digit numeric code', () => {
    const a = newAuth();
    expect(a.getPairingCode()).toMatch(/^\d{6}$/);
  });

  it('generates different codes across instances', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 25; i++) codes.add(newAuth().getPairingCode());
    // Collisions are possible but 25 identical codes would mean it is not random
    expect(codes.size).toBeGreaterThan(1);
  });

  it('regenerates a fresh code on demand (AC3.2.3)', () => {
    const a = newAuth();
    const first = a.getPairingCode();
    const second = a.regenerateCode();
    expect(second).toMatch(/^\d{6}$/);
    expect(a.getPairingCode()).toBe(second);
    // Old code must no longer pair
    expect(a.pair(first, IP)).toBeNull();
  });

  it('builds a pairing URL containing the code', () => {
    const a = newAuth();
    const url = a.getPairingUrl('localhost', 8787);
    expect(url).toContain('localhost:8787');
    expect(url).toContain(a.getPairingCode());
  });
});

describe('AuthManager — token issuance', () => {
  it('issues a 64-char hex token for a valid code (AC3.2.2)', () => {
    const a = newAuth();
    const token = a.pair(a.getPairingCode(), IP);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an incorrect code', () => {
    const a = newAuth();
    const wrong = a.getPairingCode() === '000000' ? '111111' : '000000';
    expect(a.pair(wrong, IP)).toBeNull();
  });

  it('rejects codes of the wrong length without throwing', () => {
    const a = newAuth();
    for (const bad of ['', '1', '12345', '1234567', 'abcdef']) {
      expect(() => a.pair(bad, IP)).not.toThrow();
      expect(a.pair(bad, IP)).toBeNull();
    }
  });

  it('issues a distinct token each time', () => {
    const a = newAuth();
    const code = a.getPairingCode();
    const t1 = a.pair(code, '10.0.0.1');
    const t2 = a.pair(code, '10.0.0.2');
    expect(t1).not.toBe(t2);
  });

  it('validates issued tokens and rejects others', () => {
    const a = newAuth();
    const token = a.pair(a.getPairingCode(), IP)!;
    expect(a.validateToken(token)).toBe(true);
    expect(a.validateToken('f'.repeat(64))).toBe(false);
    expect(a.validateToken('')).toBe(false);
    expect(a.validateToken('short')).toBe(false);
  });

  it('keeps earlier tokens valid after re-pairing', () => {
    const a = newAuth();
    const code = a.getPairingCode();
    const first = a.pair(code, '10.0.0.1')!;
    const second = a.pair(code, '10.0.0.2')!;
    expect(a.validateToken(first)).toBe(true);
    expect(a.validateToken(second)).toBe(true);
  });
});

describe('AuthManager — rate limiting (AC3.2.4)', () => {
  it('blocks an IP after 5 failures inside the window', () => {
    const a = newAuth();
    const ip = '203.0.113.9';
    const wrong = a.getPairingCode() === '000000' ? '111111' : '000000';

    expect(a.isRateLimited(ip)).toBe(false);
    for (let i = 0; i < 5; i++) a.pair(wrong, ip);
    expect(a.isRateLimited(ip)).toBe(true);
  });

  it('refuses even the correct code while an IP is blocked', () => {
    const a = newAuth();
    const ip = '203.0.113.10';
    const code = a.getPairingCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) a.pair(wrong, ip);
    expect(a.pair(code, ip)).toBeNull();
  });

  it('limits per IP, not globally', () => {
    const a = newAuth();
    const code = a.getPairingCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) a.pair(wrong, '203.0.113.11');
    expect(a.isRateLimited('203.0.113.11')).toBe(true);
    expect(a.isRateLimited('203.0.113.12')).toBe(false);
    expect(a.pair(code, '203.0.113.12')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not block after fewer than 5 failures', () => {
    const a = newAuth();
    const ip = '203.0.113.13';
    const code = a.getPairingCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i++) a.pair(wrong, ip);
    expect(a.isRateLimited(ip)).toBe(false);
    expect(a.pair(code, ip)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AuthManager — token persistence (context.md §7)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'aibou-auth-'));
  let n = 0;
  const nextPath = () => join(tmp, `config-${n++}.json`);

  it('a paired client survives a Bridge restart', () => {
    const configPath = nextPath();

    // First "Bridge run": pair a client.
    const first = new AuthManager({ configPath });
    const token = first.pair(first.getPairingCode(), IP)!;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // Second "Bridge run": the same token must still authenticate.
    const second = new AuthManager({ configPath });
    expect(second.validateToken(token)).toBe(true);
    expect(second.knownTokenCount).toBe(1);
  });

  it('issues a different pairing code on restart but keeps tokens', () => {
    const configPath = nextPath();
    const first = new AuthManager({ configPath });
    const oldCode = first.getPairingCode();
    const token = first.pair(oldCode, IP)!;

    const second = new AuthManager({ configPath });
    // Old code must not be reusable...
    expect(second.pair(oldCode, IP)).toBeNull();
    // ...but the already-issued token still works.
    expect(second.validateToken(token)).toBe(true);
  });

  it('writes a versioned config file', () => {
    const configPath = nextPath();
    const auth = new AuthManager({ configPath });
    auth.pair(auth.getPairingCode(), IP);

    expect(existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.tokens)).toBe(true);
    expect(parsed.tokens).toHaveLength(1);
  });

  it('accumulates tokens for multiple paired devices', () => {
    const configPath = nextPath();
    const auth = new AuthManager({ configPath });
    const code = auth.getPairingCode();
    const phone = auth.pair(code, '10.0.0.1')!;
    const watch = auth.pair(code, '10.0.0.2')!;

    const restarted = new AuthManager({ configPath });
    expect(restarted.validateToken(phone)).toBe(true);
    expect(restarted.validateToken(watch)).toBe(true);
    expect(restarted.knownTokenCount).toBe(2);
  });

  it('revokeAllTokens() forces every client to re-pair', () => {
    const configPath = nextPath();
    const auth = new AuthManager({ configPath });
    const token = auth.pair(auth.getPairingCode(), IP)!;

    auth.revokeAllTokens();
    expect(auth.validateToken(token)).toBe(false);

    const restarted = new AuthManager({ configPath });
    expect(restarted.validateToken(token)).toBe(false);
    expect(restarted.knownTokenCount).toBe(0);
  });

  it('ignores a malformed config rather than failing to start', () => {
    const configPath = nextPath();
    writeFileSync(configPath, '{ not json', 'utf-8');
    let auth: AuthManager | undefined;
    expect(() => { auth = new AuthManager({ configPath }); }).not.toThrow();
    expect(auth!.knownTokenCount).toBe(0);
    // Still able to pair afresh.
    expect(auth!.pair(auth!.getPairingCode(), IP)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tolerates a UTF-8 BOM in the config', () => {
    const configPath = nextPath();
    const token = 'a'.repeat(64);
    writeFileSync(configPath, '\uFEFF' + JSON.stringify({ version: 1, tokens: [token] }), 'utf-8');
    const auth = new AuthManager({ configPath });
    expect(auth.validateToken(token)).toBe(true);
  });

  it('rejects stored values that are not token-shaped', () => {
    const configPath = nextPath();
    writeFileSync(
      configPath,
      JSON.stringify({ version: 1, tokens: ['short', 123, null, 'Z'.repeat(64), 'b'.repeat(64)] }),
      'utf-8',
    );
    const auth = new AuthManager({ configPath });
    // Only the valid lowercase-hex entry is trusted.
    expect(auth.knownTokenCount).toBe(1);
    expect(auth.validateToken('b'.repeat(64))).toBe(true);
    expect(auth.validateToken('Z'.repeat(64))).toBe(false);
  });

  it('caps stored tokens so the file cannot grow without bound', () => {
    const configPath = nextPath();
    const auth = new AuthManager({ configPath });
    const code = auth.getPairingCode();
    for (let i = 0; i < 30; i++) auth.pair(code, `10.1.0.${i}`);

    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(parsed.tokens.length).toBeLessThanOrEqual(20);
  });

  it('does not touch the filesystem when persistence is disabled', () => {
    const configPath = nextPath();
    const auth = new AuthManager({ configPath: null });
    auth.pair(auth.getPairingCode(), IP);
    expect(existsSync(configPath)).toBe(false);
  });
});
