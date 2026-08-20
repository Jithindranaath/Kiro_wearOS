/**
 * Session Manager — registry, lifecycle, and status derivation.
 *
 * Manages active sessions, their event buffers, and derives status
 * from observed ACP events (AC1.2, AC1.4).
 */

import { EventEmitter } from 'node:events';
import type { SessionStatus } from '@aibou/protocol';
import { RingBuffer, type BufferedEvent } from './ringbuffer.js';
import { type NormalizedEvent, isTurnEnd, endsWithQuestion } from '../acp/normalize.js';
import type { SessionUpdate } from '../acp/methods.js';

export interface SessionInfo {
  id: string;
  cwd: string;
  status: SessionStatus;
  statusSource: 'observed' | 'inferred';
  statusReason?: string;
  pendingApprovals: number;
  lastActivity: number;
  createdAt: number;
}

interface SessionState {
  info: SessionInfo;
  buffer: RingBuffer;
  lastAgentText: string;
  hadToolCallInSegment: boolean;
}

export interface SessionManagerOptions {
  /** Concurrent session cap (AC1.2.3). */
  maxSessions?: number;
  /** Events retained per session for replay (AC1.3.2). */
  eventBuffer?: number;
}

const DEFAULT_MAX_SESSIONS = 4;
const DEFAULT_EVENT_BUFFER = 500;

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, SessionState>();
  private readonly maxSessions: number;
  private readonly eventBuffer: number;

  constructor(options: SessionManagerOptions = {}) {
    super();
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.eventBuffer = options.eventBuffer ?? DEFAULT_EVENT_BUFFER;
  }

  /**
   * Register a new session.
   */
  createSession(sessionId: string, cwd: string): SessionInfo {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error('AIBOU_SESSION_LIMIT');
    }

    const info: SessionInfo = {
      id: sessionId,
      cwd,
      status: 'idle',
      statusSource: 'observed',
      pendingApprovals: 0,
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };

    this.sessions.set(sessionId, {
      info,
      buffer: new RingBuffer(this.eventBuffer),
      lastAgentText: '',
      hadToolCallInSegment: false,
    });

    this.emit('session.state', info);
    return info;
  }

  /** True when no further sessions can be created (AC1.2.3). */
  get atCapacity(): boolean {
    return this.sessions.size >= this.maxSessions;
  }

  /** The configured concurrent session cap. */
  get limit(): number {
    return this.maxSessions;
  }

  /**
   * Get session info by ID.
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId)?.info;
  }

  /**
   * List all sessions.
   */
  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.info);
  }

  /**
   * Push a normalized event to a session's ring buffer.
   * Returns the assigned seq number.
   */
  pushEvent(sessionId: string, event: NormalizedEvent): number {
    const state = this.sessions.get(sessionId);
    if (!state) return 0;

    state.info.lastActivity = Date.now();
    const seq = state.buffer.push(event.kind, event.payload);

    this.emit('event', sessionId, seq, event);
    return seq;
  }

  /**
   * Update session status based on an ACP session update.
   */
  updateStatus(sessionId: string, update: SessionUpdate): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.info.lastActivity = Date.now();

    if (update.sessionUpdate === 'agent_message_chunk') {
      // Agent is working
      if (state.info.status !== 'awaiting_permission') {
        state.info.status = 'working';
        state.info.statusSource = 'observed';
        state.info.statusReason = undefined;
      }
      // Track last text for question heuristic
      const content = update.content as { text?: string } | undefined;
      if (content?.text) {
        state.lastAgentText += content.text;
      }
    } else if (update.sessionUpdate === 'tool_call') {
      state.hadToolCallInSegment = true;
      if (state.info.status !== 'awaiting_permission') {
        state.info.status = 'working';
        state.info.statusSource = 'observed';
        state.info.statusReason = undefined;
      }
    } else if (isTurnEnd(update)) {
      // Turn ended — determine if idle or awaiting_input
      if (
        !state.hadToolCallInSegment &&
        endsWithQuestion(state.lastAgentText)
      ) {
        state.info.status = 'awaiting_input';
        state.info.statusSource = 'inferred';
        state.info.statusReason =
          'Turn ended with a question and no tool call — agent may be waiting for input.';
      } else {
        state.info.status = 'idle';
        state.info.statusSource = 'observed';
        state.info.statusReason = undefined;
      }
      // Reset segment tracking
      state.lastAgentText = '';
      state.hadToolCallInSegment = false;
    }

    this.emit('session.state', state.info);
  }

  /**
   * Set status to awaiting_permission (observed).
   */
  setAwaitingPermission(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.info.status = 'awaiting_permission';
    state.info.statusSource = 'observed';
    state.info.statusReason = undefined;
    state.info.pendingApprovals++;
    state.info.lastActivity = Date.now();

    this.emit('session.state', state.info);
  }

  /**
   * Decrement pending approvals after resolution.
   */
  resolvePermission(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.info.pendingApprovals = Math.max(0, state.info.pendingApprovals - 1);
    if (state.info.pendingApprovals === 0 && state.info.status === 'awaiting_permission') {
      state.info.status = 'working';
      state.info.statusSource = 'observed';
      state.info.statusReason = undefined;
    }
    state.info.lastActivity = Date.now();

    this.emit('session.state', state.info);
  }

  /**
   * Mark session as disconnected.
   */
  setDisconnected(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.info.status = 'disconnected';
    state.info.statusSource = 'observed';
    state.info.statusReason = undefined;

    this.emit('session.state', state.info);
  }

  /**
   * Mark session as errored.
   */
  setError(sessionId: string, reason: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.info.status = 'error';
    state.info.statusSource = 'observed';
    state.info.statusReason = reason;

    this.emit('session.state', state.info);
  }

  /**
   * Complete a prompt turn using the `stopReason` returned by ACP
   * `session/prompt`. This is the authoritative end-of-turn signal in ACP v1 —
   * the real agent does not send a `turn_end` notification.
   */
  completeTurn(sessionId: string, stopReason: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.info.lastActivity = Date.now();

    if (stopReason === 'refusal') {
      state.info.status = 'error';
      state.info.statusSource = 'observed';
      state.info.statusReason = 'Agent refused to continue the turn.';
    } else if (
      stopReason === 'end_turn' &&
      !state.hadToolCallInSegment &&
      endsWithQuestion(state.lastAgentText)
    ) {
      // Heuristic — see docs/status-inference.md
      state.info.status = 'awaiting_input';
      state.info.statusSource = 'inferred';
      state.info.statusReason =
        'Turn ended with a question and no tool call — agent may be waiting for input.';
    } else {
      state.info.status = 'idle';
      state.info.statusSource = 'observed';
      state.info.statusReason =
        stopReason === 'end_turn' ? undefined : `Turn stopped: ${stopReason}`;
    }

    state.lastAgentText = '';
    state.hadToolCallInSegment = false;

    this.emit('session.state', state.info);
  }

  /**
   * Set status to working (e.g., when a prompt is sent).
   */
  setWorking(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.info.status = 'working';
    state.info.statusSource = 'observed';
    state.info.statusReason = undefined;
    state.info.lastActivity = Date.now();
    // Reset segment tracking for new turn
    state.lastAgentText = '';
    state.hadToolCallInSegment = false;

    this.emit('session.state', state.info);
  }

  /**
   * Get events from a session's ring buffer since a given seq.
   */
  getEventsSince(sessionId: string, since: number): BufferedEvent[] {
    const state = this.sessions.get(sessionId);
    if (!state) return [];
    return state.buffer.replaySince(since);
  }

  /**
   * Get the latest seq for a session.
   */
  getLatestSeq(sessionId: string): number {
    const state = this.sessions.get(sessionId);
    return state?.buffer.latestSeq ?? 0;
  }

  /**
   * Remove a session.
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Mark all sessions as disconnected (agent crashed).
   */
  disconnectAll(): void {
    for (const [sessionId] of this.sessions) {
      this.setDisconnected(sessionId);
    }
  }
}
