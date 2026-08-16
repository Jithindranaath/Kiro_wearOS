#!/usr/bin/env node
/**
 * Mock ACP Agent — test harness only.
 *
 * Implements the subset of ACP v1 that Aibou depends on, matching the
 * behaviour verified against real kiro-cli 2.18.1 (see docs/acp-findings.md):
 *
 *  - `session/prompt` params use `prompt` (NOT `content`)
 *  - `session/prompt` resolves only at end of turn, with `{ stopReason }`
 *  - `session/cancel` is a notification (no response)
 *  - turn progress arrives as `session/update` notifications
 *  - permission requests are JSON-RPC *requests* the client must answer
 *
 * This exists so CI and reviewers can exercise the full stack without Kiro
 * credentials. The Bridge advertises `mode: "mock"` whenever it is used, and
 * every client surfaces an unsuppressible mock banner.
 */

import { createInterface } from 'node:readline';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

const AGENT_NAME = 'aibou-mock-agent';
const AGENT_VERSION = '1.0.0';

let sessionCounter = 0;
const knownSessions = new Set<string>();

/** Prompt turns awaiting completion, keyed by the JSON-RPC id. */
interface ActiveTurn {
  promptRequestId: number | string;
  sessionId: string;
  permissionRequestId: string | null;
  cancelled: boolean;
  timers: ReturnType<typeof setTimeout>[];
}
const activeTurns = new Map<string, ActiveTurn>();

let permissionCounter = 0;

function send(msg: JsonRpcResponse | JsonRpcNotification): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function log(msg: string): void {
  process.stderr.write(`[mock-agent] ${msg}\n`);
}

function notifyUpdate(sessionId: string, update: Record<string, unknown>): void {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update },
  });
}

/** Finish a turn by answering the original session/prompt request. */
function endTurn(sessionId: string, stopReason: string): void {
  const turn = activeTurns.get(sessionId);
  if (!turn) return;
  turn.timers.forEach(clearTimeout);
  activeTurns.delete(sessionId);
  send({ jsonrpc: '2.0', id: turn.promptRequestId, result: { stopReason } });
  log(`turn ended for ${sessionId}: ${stopReason}`);
}

/**
 * Drive a scripted turn: stream text, announce a tool call, request permission,
 * then finish once the client answers.
 */
function runTurn(sessionId: string, promptRequestId: number | string): void {
  const toolCallId = `call_${Date.now()}`;
  const turn: ActiveTurn = {
    promptRequestId,
    sessionId,
    permissionRequestId: null,
    cancelled: false,
    timers: [],
  };
  activeTurns.set(sessionId, turn);

  const at = (ms: number, fn: () => void): void => {
    turn.timers.push(setTimeout(() => {
      if (!turn.cancelled) fn();
    }, ms));
  };

  at(300, () => {
    notifyUpdate(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg_mock_1',
      content: { type: 'text', text: 'Checking the project test setup...\n' },
    });
  });

  at(700, () => {
    notifyUpdate(sessionId, {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Inspect package scripts', priority: 'high', status: 'completed' },
        { content: 'Run the test suite', priority: 'high', status: 'pending' },
      ],
    });
  });

  at(1000, () => {
    notifyUpdate(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId,
      title: 'Execute shell command',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'npm test' },
    });
  });

  // Permission request — a JSON-RPC request the client MUST answer.
  at(1400, () => {
    permissionCounter++;
    const permId = `perm_${permissionCounter}`;
    turn.permissionRequestId = permId;
    send({
      jsonrpc: '2.0',
      id: permId,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: {
          toolCallId,
          title: 'Execute shell command',
          kind: 'execute',
          status: 'pending',
          rawInput: { command: 'npm test' },
        },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });
    log(`permission requested (${permId}) for ${sessionId}`);
  });
}

/** Continue the turn after the client answers a permission request. */
function continueAfterPermission(sessionId: string, allowed: boolean): void {
  const turn = activeTurns.get(sessionId);
  if (!turn) return;

  const at = (ms: number, fn: () => void): void => {
    turn.timers.push(setTimeout(() => {
      if (!turn.cancelled) fn();
    }, ms));
  };

  if (!allowed) {
    at(200, () => {
      notifyUpdate(sessionId, {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg_mock_2',
        content: { type: 'text', text: '\nCommand denied. Stopping here.\n' },
      });
    });
    at(500, () => endTurn(sessionId, 'end_turn'));
    return;
  }

  at(250, () => {
    notifyUpdate(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: `call_resolved_${Date.now()}`,
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'All tests passed.' } }],
    });
  });

  at(550, () => {
    notifyUpdate(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg_mock_2',
      content: { type: 'text', text: '\nTests passed. Nothing else to change.\n' },
    });
  });

  // Real context usage numbers are only emitted because a real agent would
  // send them here; the Bridge never fabricates these values.
  at(700, () => {
    notifyUpdate(sessionId, {
      sessionUpdate: 'usage_update',
      used: 1842,
      size: 200000,
    });
  });

  at(900, () => endTurn(sessionId, 'end_turn'));
}

function handleRequest(req: JsonRpcRequest): void {
  switch (req.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: true, audio: false, embeddedContext: false },
          },
          authMethods: [],
          agentInfo: { name: AGENT_NAME, title: AGENT_NAME, version: AGENT_VERSION },
        },
      });
      break;

    case 'session/new': {
      sessionCounter++;
      const sessionId = `mock-session-${sessionCounter}`;
      knownSessions.add(sessionId);
      send({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          sessionId,
          modes: {
            currentModeId: 'mock_default',
            availableModes: [{ id: 'mock_default', name: 'mock_default', description: 'Mock agent' }],
          },
        },
      });
      break;
    }

    case 'session/load': {
      const params = req.params as { sessionId?: string } | undefined;
      const sessionId = params?.sessionId;
      if (!sessionId || !knownSessions.has(sessionId)) {
        send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: 'Unknown sessionId' } });
        return;
      }
      send({ jsonrpc: '2.0', id: req.id, result: {} });
      break;
    }

    case 'session/prompt': {
      // Params use `prompt`, matching the ACP v1 spec and real kiro-cli.
      const params = req.params as
        | { sessionId?: string; prompt?: Array<{ type: string; text?: string }> }
        | undefined;
      const sessionId = params?.sessionId;

      if (!sessionId || !knownSessions.has(sessionId)) {
        send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: 'Unknown sessionId' } });
        return;
      }
      if (!Array.isArray(params?.prompt)) {
        send({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: 'Missing required param: prompt (array of content blocks)' },
        });
        return;
      }
      if (activeTurns.has(sessionId)) {
        send({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: 'Turn already in progress' } });
        return;
      }

      // No immediate response — resolves at end of turn with a stopReason.
      runTurn(sessionId, req.id);
      break;
    }

    default:
      send({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      });
  }
}

function handleNotification(note: JsonRpcNotification): void {
  if (note.method === 'session/cancel') {
    const params = note.params as { sessionId?: string } | undefined;
    const sessionId = params?.sessionId;
    if (!sessionId) return;
    const turn = activeTurns.get(sessionId);
    if (!turn) return;

    turn.cancelled = true;
    turn.timers.forEach(clearTimeout);

    // Spec: a pending permission request must be answered with "cancelled",
    // then the prompt request resolves with stopReason "cancelled".
    if (turn.permissionRequestId) {
      send({
        jsonrpc: '2.0',
        id: turn.permissionRequestId,
        result: { outcome: { outcome: 'cancelled' } },
      });
    }
    turn.cancelled = false; // allow endTurn to emit
    endTurn(sessionId, 'cancelled');
  }
}

/** Handle the client's answer to our session/request_permission. */
function handlePermissionResponse(res: JsonRpcResponse): void {
  const result = res.result as
    | { outcome?: { outcome?: string; optionId?: string } }
    | undefined;
  const outcome = result?.outcome;
  if (!outcome) return;

  const turn = [...activeTurns.values()].find((t) => t.permissionRequestId === res.id);
  if (!turn) return;

  turn.permissionRequestId = null;

  if (outcome.outcome === 'cancelled') {
    endTurn(turn.sessionId, 'cancelled');
    return;
  }

  const allowed = outcome.optionId === 'allow-once' || outcome.optionId === 'allow-always';
  log(`permission ${allowed ? 'granted' : 'denied'} (${outcome.optionId})`);
  continueAfterPermission(turn.sessionId, allowed);
}

// ─── stdin loop ──────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    log(`failed to parse: ${trimmed.slice(0, 200)}`);
    return;
  }

  const hasId = 'id' in msg && (msg as { id?: unknown }).id !== undefined;
  const hasMethod = 'method' in msg && typeof (msg as { method?: unknown }).method === 'string';

  if (hasMethod && hasId) {
    handleRequest(msg as JsonRpcRequest);
  } else if (hasMethod) {
    handleNotification(msg as JsonRpcNotification);
  } else if (hasId) {
    handlePermissionResponse(msg as JsonRpcResponse);
  }
});

rl.on('close', () => {
  log('stdin closed, exiting');
  process.exit(0);
});

log(`ready (${AGENT_NAME} v${AGENT_VERSION}) — awaiting JSON-RPC on stdin`);
