/**
 * ACP Methods — thin typed wrappers around verified ACP method names.
 *
 * This file and normalize.ts are the ONLY files that know ACP's shape.
 * If a method name changes, only these two files need updating.
 */

import { AcpClient } from './client.js';

// ─── Types matching verified ACP shapes (docs/acp-findings.md) ───────────────

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities: {
    fs?: { readTextFile?: boolean; writeTextFile?: boolean };
    terminal?: boolean;
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean };
  };
  agentInfo: {
    name: string;
    version: string;
  };
}

export interface SessionNewParams {
  cwd: string;
  mcpServers?: unknown[];
}

export interface SessionNewResult {
  sessionId: string;
}

/**
 * `session/prompt` params.
 *
 * NOTE: the content array field is named `prompt`, per the ACP v1 spec
 * (https://agentclientprotocol.com/protocol/v1/prompt-turn). Kiro's docs page
 * shows `content`, which the real agent rejects — verified against
 * kiro-cli 2.18.1, see docs/acp-findings.md.
 */
export interface SessionPromptParams {
  sessionId: string;
  prompt: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
}

/** Reason the agent stopped a prompt turn. */
export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled';

/** Response to `session/prompt`; arrives only when the whole turn is finished. */
export interface SessionPromptResult {
  stopReason: StopReason;
}

export interface SessionCancelParams {
  sessionId: string;
}

// ─── Permission request shape (incoming from agent) ──────────────────────────

export interface PermissionRequestParams {
  sessionId: string;
  toolCall: {
    toolCallId: string;
    title?: string;
    kind?: string;
    status?: string;
    rawInput?: unknown;
  };
  options: Array<{
    optionId: string;
    name: string;
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  }>;
}

export interface PermissionResponseResult {
  outcome: {
    outcome: 'selected' | 'cancelled';
    optionId?: string;
  };
}

// ─── Session update notification shapes ──────────────────────────────────────

export interface SessionUpdateParams {
  sessionId: string;
  update: SessionUpdate;
}

export type SessionUpdate =
  | AgentMessageChunkUpdate
  | AgentThoughtChunkUpdate
  | ToolCallUpdate
  | ToolCallProgressUpdate
  | PlanUpdate
  | UsageUpdate
  | TurnEndUpdate
  | UnknownUpdate;

export interface AgentMessageChunkUpdate {
  sessionUpdate: 'agent_message_chunk';
  /** Opaque id grouping chunks into one logical message. */
  messageId?: string;
  content: { type: string; text?: string } | undefined;
}

export interface AgentThoughtChunkUpdate {
  sessionUpdate: 'agent_thought_chunk';
  messageId?: string;
  content: { type: string; text?: string } | undefined;
}

/** Agent's task list for the current turn. */
export interface PlanUpdate {
  sessionUpdate: 'plan';
  entries: Array<{
    content: string;
    priority?: string;
    status?: string;
  }>;
}

/**
 * Real context/cost usage reported by the agent.
 * `used` and `size` are token counts; `cost` is optional.
 */
export interface UsageUpdate {
  sessionUpdate: 'usage_update';
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
}

export interface ToolCallUpdate {
  sessionUpdate: 'tool_call';
  toolCallId: string;
  title: string;
  kind?: string;
  status: string;
  rawInput?: unknown;
  content?: unknown[];
  locations?: unknown[];
}

export interface ToolCallProgressUpdate {
  sessionUpdate: 'tool_call_update';
  toolCallId: string;
  status?: string;
  content?: unknown[];
}

export interface TurnEndUpdate {
  sessionUpdate: 'turn_end';
}

export interface UnknownUpdate {
  sessionUpdate: string;
  [key: string]: unknown;
}

// ─── Method wrappers ─────────────────────────────────────────────────────────

export class AcpMethods {
  constructor(
    private client: AcpClient,
    private clientVersion: string = '0.0.0',
  ) {}

  /**
   * Handshake with the agent.
   *
   * Bounded by a timeout: a real kiro-cli replies in ~2s, so a much larger
   * budget still fails fast if the binary is wrong or the agent is wedged,
   * instead of leaving the Bridge waiting forever.
   */
  async initialize(timeoutMs = 30_000): Promise<InitializeResult> {
    const params: InitializeParams = {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: {
        name: 'aibou-bridge',
        version: this.clientVersion,
      },
    };
    return (await this.client.request('initialize', params, timeoutMs)) as InitializeResult;
  }

  async sessionNew(cwd: string): Promise<SessionNewResult> {
    const params: SessionNewParams = { cwd, mcpServers: [] };
    return (await this.client.request('session/new', params)) as SessionNewResult;
  }

  /**
   * Start a prompt turn. The returned promise only settles when the agent
   * finishes the entire turn, so callers must not block a client ack on it.
   */
  async sessionPrompt(sessionId: string, text: string): Promise<SessionPromptResult> {
    const params: SessionPromptParams = {
      sessionId,
      prompt: [{ type: 'text', text }],
    };
    return (await this.client.request('session/prompt', params)) as SessionPromptResult;
  }

  /**
   * Cancel the in-flight prompt turn.
   *
   * Per the ACP v1 spec this is a NOTIFICATION, not a request — the agent never
   * replies to it. Confirmation arrives as the `session/prompt` response with
   * `stopReason: "cancelled"`.
   */
  sessionCancel(sessionId: string): void {
    const params: SessionCancelParams = { sessionId };
    this.client.notify('session/cancel', params);
  }

  /**
   * Respond to a permission request from the agent.
   */
  approvePermission(requestId: number | string, optionId: string): void {
    const result: PermissionResponseResult = {
      outcome: { outcome: 'selected', optionId },
    };
    this.client.respond(requestId, result);
  }

  /**
   * Cancel a permission request (e.g., on session cancel).
   */
  cancelPermission(requestId: number | string): void {
    const result: PermissionResponseResult = {
      outcome: { outcome: 'cancelled' },
    };
    this.client.respond(requestId, result);
  }
}
