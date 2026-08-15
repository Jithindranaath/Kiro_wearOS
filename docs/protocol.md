# AWP — Aibou Wire Protocol

> Full message reference for the WebSocket protocol between Bridge and clients.
> Source of truth: `packages/protocol/src/frames.ts`

## Transport

- Single WebSocket connection at `/ws`
- JSON text frames
- Every frame has: `v: 1`, `t: string`, `ts: number`, optional `id: string`

## Client → Server

| Frame type | Description |
|---|---|
| `auth` | First frame. Contains `token`. |
| `subscribe` | Subscribe to events. Optional `sessionId`, `since`. |
| `session.create` | Create a new session. Requires `cwd`. |
| `session.list` | List all sessions. |
| `prompt.send` | Send a prompt. Requires `sessionId`, `text`. |
| `permission.respond` | Approve/deny. Requires `approvalId`, `decision`. |
| `session.interrupt` | Cancel current operation. Requires `sessionId`. |
| `pong` | Response to heartbeat. |

## Server → Client

| Frame type | Description |
|---|---|
| `hello` | Sent after auth. Contains `mode`, `bridgeVersion`, `capabilities`. |
| `ack` | Acknowledgment with optional `result`. |
| `error` | Error with `code`, `message`, `retryable`. |
| `session.state` | Session status update. |
| `event` | Stream event with `seq`, `kind`, `payload`. |
| `permission.request` | Approval needed. Contains `summary`, `toolInput`, `riskTier`. |
| `permission.resolved` | Approval resolved. Contains `decision`, `resolution`. |
| `heartbeat` | Keepalive. Client must respond with `pong`. |

## Error Codes

```
AIBOU_UNAUTHORIZED
AIBOU_BAD_CWD
AIBOU_SESSION_LIMIT
AIBOU_SESSION_NOT_FOUND
AIBOU_ALREADY_RESOLVED
AIBOU_APPROVAL_NOT_FOUND
AIBOU_UNSUPPORTED
AIBOU_AGENT_DOWN
AIBOU_RATE_LIMITED
AIBOU_BAD_FRAME
AIBOU_INTERNAL
```

## Event Kinds

```
agent.text · agent.thought · tool.start · tool.end · task.update · usage · session.error · unknown
```

`unknown` is mandatory — unrecognized ACP frames are preserved, never dropped.
