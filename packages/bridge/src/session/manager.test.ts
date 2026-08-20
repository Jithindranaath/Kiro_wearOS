import { describe, it, expect } from 'vitest';
import { SessionManager } from './manager.js';
import type { SessionUpdate } from '../acp/methods.js';

const CWD = '/project';

function chunk(text: string): SessionUpdate {
  return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } as SessionUpdate;
}

const TOOL_CALL: SessionUpdate = {
  sessionUpdate: 'tool_call',
  toolCallId: 'tc1',
  title: 'Running: npm test',
  status: 'pending',
} as SessionUpdate;

describe('SessionManager — lifecycle', () => {
  it('creates a session in observed idle state', () => {
    const m = new SessionManager();
    const info = m.createSession('s1', CWD);
    expect(info.status).toBe('idle');
    expect(info.statusSource).toBe('observed');
    expect(info.statusReason).toBeUndefined();
    expect(info.pendingApprovals).toBe(0);
    expect(info.cwd).toBe(CWD);
  });

  it('lists created sessions', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    m.createSession('s2', '/other');
    expect(m.listSessions().map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('enforces the configured session cap (AC1.2.3)', () => {
    const m = new SessionManager({ maxSessions: 2 });
    m.createSession('s1', CWD);
    expect(m.atCapacity).toBe(false);
    m.createSession('s2', CWD);
    expect(m.atCapacity).toBe(true);
    expect(m.limit).toBe(2);
    expect(() => m.createSession('s3', CWD)).toThrow('AIBOU_SESSION_LIMIT');
  });

  it('removes sessions', () => {
    const m = new SessionManager({ maxSessions: 1 });
    m.createSession('s1', CWD);
    expect(m.atCapacity).toBe(true);
    m.removeSession('s1');
    expect(m.atCapacity).toBe(false);
    expect(m.getSession('s1')).toBeUndefined();
  });

  it('ignores updates for unknown sessions without throwing', () => {
    const m = new SessionManager();
    expect(() => m.updateStatus('ghost', chunk('hi'))).not.toThrow();
    expect(() => m.completeTurn('ghost', 'end_turn')).not.toThrow();
    expect(() => m.setAwaitingPermission('ghost')).not.toThrow();
    expect(m.pushEvent('ghost', { kind: 'agent.text', payload: {} })).toBe(0);
  });
});

describe('SessionManager — status transitions', () => {
  it('goes to working when a prompt is sent', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    m.setWorking('s1');
    const info = m.getSession('s1')!;
    expect(info.status).toBe('working');
    expect(info.statusSource).toBe('observed');
  });

  it('goes to observed idle on end_turn with no question', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    m.setWorking('s1');
    m.updateStatus('s1', chunk('All done.'));
    m.completeTurn('s1', 'end_turn');

    const info = m.getSession('s1')!;
    expect(info.status).toBe('idle');
    expect(info.statusSource).toBe('observed');
    expect(info.statusReason).toBeUndefined();
  });

  it('infers awaiting_input when the turn ends on a question with no tool call', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    m.setWorking('s1');
    m.updateStatus('s1', chunk('Which file should I edit?'));
    m.completeTurn('s1', 'end_turn');

    const info = m.getSession('s1')!;
    expect(info.status).toBe('awaiting_input');
    expect(info.statusSource).toBe('inferred');
    // Every inferred status must explain itself (AC1.4.3)
    expect(info.statusReason).toBeTruthy();
  });

  it('does not infer awaiting_input when a tool call ran in the turn', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    m.setWorking('s1');
    m.updateStatus('s1', TOOL_CALL);
    m.updateStatus('s1', chunk('Did that work?'));
    m.completeTurn('s1', 'end_turn');

    expect(m.getSession('s1')!.status).toBe('idle');
    expect(m.getSession('s1')!.statusSource).toBe('observed');
  });

  it('reports a reason for non-end_turn stop reasons but keeps them observed', () => {
    for (const reason of ['max_tokens', 'max_turn_requests', 'cancelled']) {
      const m = new SessionManager();
      m.createSession('s1', CWD);
      m.setWorking('s1');
      m.completeTurn('s1', reason);

      const info = m.getSession('s1')!;
      expect(info.status).toBe('idle');
      expect(info.statusSource).toBe('observed');
      expect(info.statusReason).toContain(reason);
    }
  });

  it('treats refusal as an observed error', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    m.completeTurn('s1', 'refusal');

    const info = m.getSession('s1')!;
    expect(info.status).toBe('error');
    expect(info.statusSource).toBe('observed');
    expect(info.statusReason).toBeTruthy();
  });

  it('resets question tracking between turns', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);

    m.setWorking('s1');
    m.updateStatus('s1', chunk('Continue?'));
    m.completeTurn('s1', 'end_turn');
    expect(m.getSession('s1')!.status).toBe('awaiting_input');

    // Second turn ends without a question — must not stay inferred
    m.setWorking('s1');
    m.updateStatus('s1', chunk('Done.'));
    m.completeTurn('s1', 'end_turn');
    expect(m.getSession('s1')!.status).toBe('idle');
    expect(m.getSession('s1')!.statusSource).toBe('observed');
  });
});

describe('SessionManager — pending approvals', () => {
  it('tracks awaiting_permission and the pending count', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);

    m.setAwaitingPermission('s1');
    let info = m.getSession('s1')!;
    expect(info.status).toBe('awaiting_permission');
    expect(info.statusSource).toBe('observed');
    expect(info.pendingApprovals).toBe(1);

    m.setAwaitingPermission('s1');
    expect(m.getSession('s1')!.pendingApprovals).toBe(2);

    m.resolvePermission('s1');
    info = m.getSession('s1')!;
    expect(info.pendingApprovals).toBe(1);
    // Still awaiting because one remains
    expect(info.status).toBe('awaiting_permission');

    m.resolvePermission('s1');
    info = m.getSession('s1')!;
    expect(info.pendingApprovals).toBe(0);
    expect(info.status).toBe('working');
  });

  it('never drops the pending count below zero', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    m.resolvePermission('s1');
    m.resolvePermission('s1');
    expect(m.getSession('s1')!.pendingApprovals).toBe(0);
  });

  it('keeps status awaiting_permission while an approval is held, even during output', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    m.setAwaitingPermission('s1');
    // Agent output arriving must not clear the awaiting state
    m.updateStatus('s1', chunk('thinking...'));
    expect(m.getSession('s1')!.status).toBe('awaiting_permission');
  });
});

describe('SessionManager — events and replay', () => {
  it('assigns increasing seq numbers per session', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    expect(m.pushEvent('s1', { kind: 'agent.text', payload: { text: 'a' } })).toBe(1);
    expect(m.pushEvent('s1', { kind: 'agent.text', payload: { text: 'b' } })).toBe(2);
    expect(m.getLatestSeq('s1')).toBe(2);
  });

  it('keeps sequences independent per session', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    m.createSession('s2', CWD);
    m.pushEvent('s1', { kind: 'agent.text', payload: {} });
    m.pushEvent('s1', { kind: 'agent.text', payload: {} });
    expect(m.pushEvent('s2', { kind: 'agent.text', payload: {} })).toBe(1);
  });

  it('replays only events after the requested seq', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    for (let i = 0; i < 5; i++) {
      m.pushEvent('s1', { kind: 'agent.text', payload: { i } });
    }
    const replay = m.getEventsSince('s1', 3);
    expect(replay.map((e) => e.seq)).toEqual([4, 5]);
  });

  it('honours a custom event buffer size', () => {
    const m = new SessionManager({ eventBuffer: 3 });
    m.createSession('s1', CWD);
    for (let i = 1; i <= 6; i++) {
      m.pushEvent('s1', { kind: 'agent.text', payload: { i } });
    }
    const all = m.getEventsSince('s1', 0);
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.seq)).toEqual([4, 5, 6]);
  });

  it('returns an empty replay for unknown sessions', () => {
    const m = new SessionManager();
    expect(m.getEventsSince('ghost', 0)).toEqual([]);
    expect(m.getLatestSeq('ghost')).toBe(0);
  });
});

describe('SessionManager — disconnect and error', () => {
  it('marks every session disconnected when the agent dies', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    m.createSession('s2', CWD);
    m.disconnectAll();
    expect(m.listSessions().every((s) => s.status === 'disconnected')).toBe(true);
    expect(m.listSessions().every((s) => s.statusSource === 'observed')).toBe(true);
  });

  it('records an error with a reason', () => {
    const m = new SessionManager();
    m.createSession('s1', CWD);
    m.setError('s1', 'Prompt failed: boom');
    const info = m.getSession('s1')!;
    expect(info.status).toBe('error');
    expect(info.statusReason).toContain('boom');
  });

  it('emits session.state on every transition', () => {
    const m = new SessionManager();
    const seen: string[] = [];
    m.on('session.state', (info: { status: string }) => seen.push(info.status));

    m.createSession('s1', CWD);
    m.setWorking('s1');
    m.setAwaitingPermission('s1');
    m.resolvePermission('s1');
    m.completeTurn('s1', 'end_turn');
    m.setDisconnected('s1');

    expect(seen).toEqual([
      'idle',
      'working',
      'awaiting_permission',
      'working',
      'idle',
      'disconnected',
    ]);
  });

  it('advances lastActivity on activity', async () => {
    const m = new SessionManager();
    const info = m.createSession('s1', CWD);
    const initial = info.lastActivity;
    await new Promise((r) => setTimeout(r, 5));
    m.pushEvent('s1', { kind: 'agent.text', payload: {} });
    expect(m.getSession('s1')!.lastActivity).toBeGreaterThanOrEqual(initial);
  });
});
