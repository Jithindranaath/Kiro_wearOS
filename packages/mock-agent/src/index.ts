#!/usr/bin/env node
/**
 * Mock ACP Agent
 *
 * Implements the verified subset of ACP over stdin/stdout.
 * Scenario-driven: reads a JSON scenario file and replays events on a timer.
 * Used for tests, CI, and `aibou --mock` demo mode.
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

let sessionCounter = 0;
let activeSessionId: string | null = null;

function send(msg: JsonRpcResponse | JsonRpcNotification): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
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
            promptCapabilities: { image: true },
          },
          agentInfo: {
            name: 'aibou-mock-agent',
            version: '1.0.0',
          },
        },
      });
      break;

    case 'session/new': {
      sessionCounter++;
      activeSessionId = `mock_sess_${sessionCounter}`;
      send({
        jsonrpc: '2.0',
        id: req.id,
        result: { sessionId: activeSessionId },
      });
      break;
    }

    case 'session/prompt': {
      send({ jsonrpc: '2.0', id: req.id, result: { acknowledged: true } });

      // Simulate agent working: emit a text chunk, then a tool call with permission request
      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: activeSessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Let me analyze that for you...\n' },
            },
          },
        });
      }, 500);

      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: activeSessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: `call_${Date.now()}`,
              title: 'Running npm test',
              kind: 'shell',
              status: 'pending',
              rawInput: { command: 'npm test' },
            },
          },
        });
      }, 1000);

      // Permission request after 1.5s
      setTimeout(() => {
        pendingPermissionId++;
        send({
          jsonrpc: '2.0',
          id: `perm_${pendingPermissionId}`,
          method: 'session/request_permission',
          params: {
            sessionId: activeSessionId,
            toolCall: {
              toolCallId: `call_${Date.now()}`,
              title: 'Execute shell command',
              kind: 'shell',
              status: 'pending',
              rawInput: { command: 'npm test' },
            },
            options: [
              { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
            ],
          },
        });
      }, 1500);
      break;
    }

    case 'session/cancel': {
      send({ jsonrpc: '2.0', id: req.id, result: { cancelled: true } });
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

let pendingPermissionId = 0;

// Read JSON-RPC from stdin, line by line
const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line) as JsonRpcRequest | JsonRpcResponse;
    if ('method' in msg && 'id' in msg) {
      handleRequest(msg as JsonRpcRequest);
    }
    // If it's a response (to our permission request), just log it
    if ('result' in msg && !('method' in msg)) {
      // Client responded to our permission request
      process.stderr.write(`[mock-agent] Permission response: ${JSON.stringify(msg)}\n`);

      // After permission granted, simulate tool completion and turn end
      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: activeSessionId,
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: `call_resolved`,
              status: 'completed',
              content: [{ type: 'content', content: { type: 'text', text: 'All tests passed.' } }],
            },
          },
        });
      }, 300);

      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: activeSessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: '\n✅ Done! All tests passing.\n' },
            },
          },
        });
      }, 600);

      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: activeSessionId,
            update: { sessionUpdate: 'turn_end' },
          },
        });
      }, 800);
    }
  } catch {
    process.stderr.write(`[mock-agent] Failed to parse: ${line}\n`);
  }
});

process.stderr.write('[mock-agent] Ready. Awaiting JSON-RPC on stdin.\n');
