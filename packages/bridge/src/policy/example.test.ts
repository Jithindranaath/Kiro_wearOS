import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Policy } from '@aibou/protocol';
import { PolicyEngine } from './engine.js';

/**
 * The shipped example config must actually load and behave as documented.
 * A README/example that does not work is worse than no example.
 */
const EXAMPLE_PATH = resolve(
  fileURLToPath(import.meta.url),
  '../../../../../examples/policy.example.json',
);

const CWD = '/project';

describe('examples/policy.example.json', () => {
  const raw = readFileSync(EXAMPLE_PATH, 'utf-8');

  it('is valid JSON', () => {
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });

  it('validates against the Policy schema', () => {
    const parsed = Policy.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `example policy failed validation: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ')}`,
      );
    }
    expect(parsed.success).toBe(true);
  });

  it('has unique rule ids', () => {
    const policy = Policy.parse(JSON.parse(raw));
    const ids = policy.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('loads via the engine and reports itself as a file policy', () => {
    const engine = new PolicyEngine({ policyPath: EXAMPLE_PATH });
    expect(engine.policySource).toBe('file');
    expect(engine.isParanoid).toBe(false);
    expect(engine.error).toBeNull();
  });

  describe('behaves as its comments claim', () => {
    const engine = new PolicyEngine({ policyPath: EXAMPLE_PATH });
    const ev = (toolName: string, rawInput: unknown) =>
      engine.evaluate({ toolName, rawInput, cwd: CWD });

    it('denies writes to ~/.aibou/', () => {
      const r = ev('fs_write', { path: '/home/u/.aibou/policy.json' });
      expect(r.decision).toBe('deny');
      expect(r.ruleId).toBe('deny-aibou-self-modification');
    });

    it('denies force pushes and hard resets', () => {
      expect(ev('shell', { command: 'git push --force' }).decision).toBe('deny');
      expect(ev('shell', { command: 'git push -f origin main' }).decision).toBe('deny');
      expect(ev('shell', { command: 'git reset --hard HEAD~3' }).decision).toBe('deny');
    });

    it('escalates secret file access even for read tools', () => {
      for (const p of ['/project/.env', '/home/u/.ssh/id_rsa', '/home/u/.aws/credentials']) {
        expect(ev('fs_read', { path: p }).decision).toBe('escalate');
      }
    });

    it('escalates dangerous commands', () => {
      for (const c of ['rm -rf /', 'sudo apt install x', 'chmod 777 /etc', 'npm publish']) {
        expect(ev('shell', { command: c }).decision).toBe('escalate');
      }
    });

    it('escalates writes outside the project', () => {
      expect(ev('fs_write', { path: '/etc/hosts' }).decision).toBe('escalate');
    });

    it('allows reads inside the project', () => {
      expect(ev('fs_read', { path: `${CWD}/src/main.ts` }).decision).toBe('allow');
    });

    it('allows writes inside the project', () => {
      expect(ev('fs_write', { path: `${CWD}/src/main.ts` }).decision).toBe('allow');
    });

    it('allows the documented test commands', () => {
      for (const c of ['npm test', 'pnpm test', 'cargo test', 'pytest']) {
        expect(ev('shell', { command: c }).decision).toBe('allow');
      }
    });

    it('still fails closed for anything unmatched', () => {
      expect(ev('some_unknown_tool', {}).decision).toBe('escalate');
      expect(ev('shell', { command: 'curl https://example.com' }).decision).toBe('escalate');
    });
  });
});
