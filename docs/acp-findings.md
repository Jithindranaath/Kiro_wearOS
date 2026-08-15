# ACP Findings

> This document records verified answers to the assumptions in `context.md` §8.
> Updated as we verify each assumption against the real `kiro-cli`.

## Environment

- **kiro-cli version:** 2.3.0
- **OS:** Windows 11
- **Node.js:** v24.12.0

---

## Verified Assumptions

### A1: ACP agent launch command ✅

```bash
kiro-cli acp
```

Additional flags:
- `--agent <AGENT>` — specify agent name
- `--model <MODEL>` — specify model
- `--trust-all-tools` — auto-approve all permissions
- `--trust-tools <TOOL_NAMES>` — trust specific tools
- `--agent-engine <ENGINE>` — "rust" (default) or "kas"

### A2: Transport is JSON-RPC 2.0 over stdin/stdout ✅

Confirmed via the ACP docs. The agent communicates over stdin/stdout using JSON-RPC 2.0.

### A3: Method names ✅

Confirmed from https://kiro.dev/docs/cli/acp/:
- `initialize`
- `session/new`
- `session/load`
- `session/prompt`
- `session/cancel`
- `session/set_mode`
- `session/set_model`

### A4: Session update notifications ✅

The agent sends `session/update` notifications with these update types:
- `agent_message_chunk` — streaming text/content
- `tool_call` — tool invocation with name, params, status
- `tool_call_update` — progress updates for running tools
- `turn_end` — signals agent turn completed (mapped as `TurnEnd` in docs)

### A5: Permission requests ✅ CRITICAL

Method: `session/request_permission`

This is a JSON-RPC **request** from agent to client (has an `id`).
The client holds it open and responds with the user's decision.

**Request shape:**
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "session/request_permission",
  "params": {
    "sessionId": "sess_abc123def456",
    "toolCall": {
      "toolCallId": "call_001",
      "title": "...",
      "kind": "shell",
      "status": "pending",
      "rawInput": { ... }
    },
    "options": [
      { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
      { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" }
    ]
  }
}
```

**Response shape:**
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "outcome": {
      "outcome": "selected",
      "optionId": "allow-once"
    }
  }
}
```

Or on cancellation:
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "outcome": {
      "outcome": "cancelled"
    }
  }
}
```

### A6: Capabilities ✅

From the initialize response:
- `loadSession: true`
- `promptCapabilities.image: true`

### A7: Kiro extensions ✅

Prefixed with `_kiro.dev/` per ACP spec. Safely ignorable. Known extensions:
- `_kiro.dev/commands/execute`
- `_kiro.dev/commands/options`
- `_kiro.dev/commands/available`
- `_kiro.dev/mcp/oauth_request`
- `_kiro.dev/mcp/server_initialized`
- `_kiro.dev/compaction/status`
- `_kiro.dev/clear/status`
- `_session/terminate`

### A8: CLI hooks — TODO

Need to verify with a real hook.

### A9: Token/context usage — TODO

Need to inspect live ACP frames for usage fields. If absent, drop the feature.

### A10: Cancellation ✅

Method: `session/cancel`

Confirmed in the ACP docs as a core protocol method.

---

## Key Insights

1. The permission request is a JSON-RPC **request** (not a notification). This means
   the agent BLOCKS waiting for our response. This is exactly what we need — we can
   hold the response indefinitely until the phone/watch user responds.

2. The `toolCall` field in the permission request gives us `title`, `kind`, and
   `rawInput` — enough to build the `summary` field and determine `riskTier`.

3. The `options` array tells us what responses the agent accepts. We should forward
   these to the client rather than hardcoding allow/deny.

4. `--trust-all-tools` and `--trust-tools` are the CLI's built-in equivalent of our
   policy engine. Our engine supersedes them (we won't use those flags).
