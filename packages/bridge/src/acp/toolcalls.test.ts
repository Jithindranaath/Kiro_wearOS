import { describe, it, expect } from 'vitest';
import { ToolCallRegistry } from './toolcalls.js';

/**
 * The registry exists because real kiro-cli sends permission requests with only
 * `toolCallId` + `title`; the command lives in an earlier `tool_call` update.
 */
describe('ToolCallRegistry', () => {
  it('records and retrieves tool call details by id', () => {
    const reg = new ToolCallRegistry();
    reg.record('s1', {
      toolCallId: 'tooluse_abc',
      title: 'Running: node --version',
      kind: 'execute',
      rawInput: { command: 'node --version' },
    });

    const found = reg.get('tooluse_abc');
    expect(found?.kind).toBe('execute');
    expect(found?.title).toBe('Running: node --version');
    expect(found?.rawInput).toEqual({ command: 'node --version' });
    expect(found?.sessionId).toBe('s1');
  });

  it('extracts the Kiro tool name from _meta.kiro.toolName', () => {
    const reg = new ToolCallRegistry();
    reg.record('s1', {
      toolCallId: 'tc1',
      kind: 'execute',
      _meta: { kiro: { toolName: 'shell' } },
    });
    expect(reg.get('tc1')?.kiroToolName).toBe('shell');
  });

  it('returns undefined for unknown or missing ids', () => {
    const reg = new ToolCallRegistry();
    expect(reg.get('nope')).toBeUndefined();
    expect(reg.get(undefined)).toBeUndefined();
  });

  it('ignores updates with no toolCallId', () => {
    const reg = new ToolCallRegistry();
    reg.record('s1', { title: 'no id here' });
    expect(reg.size).toBe(0);
  });

  it('merges later updates without erasing earlier fields', () => {
    const reg = new ToolCallRegistry();
    // tool_call carries the full input
    reg.record('s1', {
      toolCallId: 'tc1',
      title: 'Running: npm test',
      kind: 'execute',
      rawInput: { command: 'npm test' },
      _meta: { kiro: { toolName: 'shell' } },
    });
    // tool_call_update carries only a status change
    reg.record('s1', { toolCallId: 'tc1', status: 'completed' });

    const found = reg.get('tc1');
    expect(found?.rawInput).toEqual({ command: 'npm test' });
    expect(found?.kind).toBe('execute');
    expect(found?.kiroToolName).toBe('shell');
    expect(found?.title).toBe('Running: npm test');
  });

  it('clears only the requested session', () => {
    const reg = new ToolCallRegistry();
    reg.record('s1', { toolCallId: 'a' });
    reg.record('s2', { toolCallId: 'b' });

    reg.clearSession('s1');
    expect(reg.get('a')).toBeUndefined();
    expect(reg.get('b')).toBeDefined();
  });

  it('evicts oldest entries beyond capacity', () => {
    const reg = new ToolCallRegistry(3);
    for (let i = 1; i <= 5; i++) {
      reg.record('s1', { toolCallId: `tc${i}` });
    }
    expect(reg.size).toBe(3);
    // The two oldest should be gone
    expect(reg.get('tc1')).toBeUndefined();
    expect(reg.get('tc2')).toBeUndefined();
    expect(reg.get('tc5')).toBeDefined();
  });

  it('tolerates malformed _meta shapes', () => {
    const reg = new ToolCallRegistry();
    expect(() => reg.record('s1', { toolCallId: 'x', _meta: 'nope' })).not.toThrow();
    expect(() => reg.record('s1', { toolCallId: 'y', _meta: { kiro: 5 } })).not.toThrow();
    expect(reg.get('x')?.kiroToolName).toBeUndefined();
    expect(reg.get('y')?.kiroToolName).toBeUndefined();
  });
});
