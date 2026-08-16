import { describe, it, expect } from 'vitest';
import { normalizeSessionUpdate, isTurnEnd, endsWithQuestion } from './normalize.js';
import type { SessionUpdateParams } from './methods.js';

function norm(update: unknown) {
  return normalizeSessionUpdate({ sessionId: 's1', update } as SessionUpdateParams);
}

describe('normalizeSessionUpdate', () => {
  it('maps agent_message_chunk to agent.text with real text', () => {
    const r = norm({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'hello world' },
    });
    expect(r.kind).toBe('agent.text');
    expect(r.payload).toMatchObject({ text: 'hello world', messageId: 'm1' });
  });

  it('maps agent_thought_chunk to agent.thought', () => {
    const r = norm({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'thinking' },
    });
    expect(r.kind).toBe('agent.thought');
    expect(r.payload).toMatchObject({ text: 'thinking' });
  });

  it('maps tool_call to tool.start preserving rawInput', () => {
    const r = norm({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc1',
      title: 'Running: node --version',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'node --version' },
    });
    expect(r.kind).toBe('tool.start');
    expect(r.payload).toMatchObject({
      toolCallId: 'tc1',
      kind: 'execute',
      rawInput: { command: 'node --version' },
    });
  });

  it('maps tool_call_update to tool.end', () => {
    const r = norm({ sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'completed' });
    expect(r.kind).toBe('tool.end');
    expect(r.payload).toMatchObject({ toolCallId: 'tc1', status: 'completed' });
  });

  it('maps plan to task.update with entries', () => {
    const entries = [{ content: 'step one', status: 'pending' }];
    const r = norm({ sessionUpdate: 'plan', entries });
    expect(r.kind).toBe('task.update');
    expect(r.payload).toMatchObject({ entries });
  });

  it('maps usage_update to usage, passing through real numbers only', () => {
    const r = norm({ sessionUpdate: 'usage_update', used: 1234, size: 200000 });
    expect(r.kind).toBe('usage');
    expect(r.payload).toEqual({ used: 1234, size: 200000, cost: undefined });
  });

  it('passes through cost when the agent reports it', () => {
    const r = norm({
      sessionUpdate: 'usage_update',
      used: 10,
      size: 100,
      cost: { amount: 0.045, currency: 'USD' },
    });
    expect(r.payload).toMatchObject({ cost: { amount: 0.045, currency: 'USD' } });
  });

  it('falls back to unknown for unrecognised updates and preserves the payload (AC1.3.5)', () => {
    const raw = { sessionUpdate: 'some_future_thing', mystery: 42 };
    const r = norm(raw);
    expect(r.kind).toBe('unknown');
    expect(r.payload).toEqual(raw);
  });

  it('never throws on missing or malformed content', () => {
    expect(() => norm({ sessionUpdate: 'agent_message_chunk' })).not.toThrow();
    expect(() => norm({ sessionUpdate: 'agent_message_chunk', content: null })).not.toThrow();
    const r = norm({ sessionUpdate: 'agent_message_chunk', content: undefined });
    expect(r.payload).toMatchObject({ text: '' });
  });
});

describe('isTurnEnd', () => {
  it('detects the turn_end update', () => {
    expect(isTurnEnd({ sessionUpdate: 'turn_end' } as never)).toBe(true);
  });

  it('is false for other updates', () => {
    expect(isTurnEnd({ sessionUpdate: 'agent_message_chunk' } as never)).toBe(false);
  });
});

describe('endsWithQuestion', () => {
  it('is true for trailing question marks, ignoring trailing whitespace', () => {
    expect(endsWithQuestion('Shall I continue?')).toBe(true);
    expect(endsWithQuestion('Shall I continue?  \n')).toBe(true);
  });

  it('is false otherwise', () => {
    expect(endsWithQuestion('Done.')).toBe(false);
    expect(endsWithQuestion('')).toBe(false);
    expect(endsWithQuestion('Is this? Yes.')).toBe(false);
  });
});
