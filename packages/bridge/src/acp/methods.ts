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

export interface SessionPromptParams {
  sessionId: string;
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
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
  | ToolCallUpdate
  | ToolCallProgressUpdate
  | TurnEndUpdate
  | UnknownUpdate;

export interface AgentMessageChunkUpdate {
  sessionUpdate: 'agent_message_chunk';
  content: { type: string; text?: string } | undefined;
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
  constructor(private client: AcpClient) {}

  async initialize(): Promise<InitializeResult> {
    const params: InitializeParams = {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: {
        name: 'aibou-bridge',
        version: '1.0.0',
      },
    };
    return (await this.client.request('initialize', params)) as InitializeResult;
  }

  async sessionNew(cwd: string): Promise<SessionNewResult> {
    const params: SessionNewParams = { cwd, mcpServers: [] };
    return (await this.client.request('session/new', params)) as SessionNewResult;
  }

  async sessionPrompt(sessionId: string, text: string): Promise<unknown> {
    const params: SessionPromptParams = {
      sessionId,
      content: [{ type: 'text', text }],
    };
    return await this.client.request('session/prompt', params);
  }

  async sessionCancel(sessionId: string): Promise<unknown> {
    const params: SessionCancelParams = { sessionId };
    return await this.client.request('session/cancel', params);
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
