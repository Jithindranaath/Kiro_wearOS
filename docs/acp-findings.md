# ACP Findings

Verified answers to the assumptions in `context.md` §8, captured by running the
Bridge against a real `kiro-cli` ACP agent with `--trace` and reading the raw
JSON-RPC frames from `~/.aibou/logs/acp-<date>.jsonl`.

## Environment

| | |
|---|---|
| `kiro-cli` CLI version | 2.3.0 |
| ACP agent reported version | **Kiro CLI Agent 2.18.1** |
| ACP protocol version | 1 |
| OS | Windows 11 |
| Node.js | v24.12.0 |

---

## Corrections to Kiro's published docs

Two things on <https://kiro.dev/docs/cli/acp/> do not match the shipped agent.
Both were found by tracing real frames, and both are load-bearing.

### 1. `session/prompt` takes `prompt`, not `content`

Kiro's docs page shows:

```json
{ "method": "session/prompt", "params": { "sessionId": "...", "content": [ ... ] } }
```

The real agent requires `prompt`, matching the
[ACP v1 spec](https://agentclientprotocol.com/protocol/v1/prompt-turn):

```json
{ "method": "session/prompt", "params": { "sessionId": "...", "prompt": [ { "type": "text", "text": "..." } ] } }
```

**Observed failure with `content`:** the agent exits with code 0 immediately,
producing no response and no error. The Bridge then reports
`Agent exited while waiting for response to session/prompt`. Silent process
death, no diagnostic.

### 2. Session updates arrive as `session/update`

The docs say updates are delivered via `session/notification`. Traced frames use
`session/update`. The Bridge accepts both so it does not break if this changes.

---

## Verified assumptions

### A1 — ACP launch command ✅

```bash
kiro-cli acp
```

Flags: `--agent`, `--model`, `--trust-all-tools`, `--trust-tools`,
`--agent-engine <rust|kas>`. Aibou uses none of the trust flags; the policy
engine supersedes them.

Override the binary with `AIBOU_KIRO_BIN`.

### A2 — Transport ✅

JSON-RPC 2.0, newline-delimited, over the child process's stdin/stdout.

### A3 — Method names ✅

`initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`,
`session/set_mode`, `session/set_model`.

### A4 — Session update notifications ✅

Method: `session/update`, params `{ sessionId, update }`. Observed
`update.sessionUpdate` values:

| Value | Meaning |
|---|---|
| `agent_message_chunk` | Streaming assistant text. Carries optional `messageId`. |
| `agent_thought_chunk` | Streaming reasoning text. |
| `tool_call` | New tool invocation. Carries `kind`, `rawInput`, `_meta`. |
| `tool_call_update` | Status/content update for an existing `toolCallId`. |
| `plan` | Task list (`entries[]`). |
| `usage_update` | Real token usage: `used`, `size`, optional `cost`. |

Text arrives in very small chunks — a one-sentence reply was split across 30+
`agent_message_chunk` frames.

### A5 — Permission requests ✅ (critical)

Method: `session/request_permission`. It is a **request** with an `id`, so the
agent blocks until answered. This is the mechanism Aibou is built on.

**The permission request is minimal.** Real frame:

```json
{
  "jsonrpc": "2.0",
  "id": "5aa73b0d-3932-4144-84ce-75ed2ca2f2f3",
  "method": "session/request_permission",
  "params": {
    "sessionId": "e152157f-fd47-4da8-bdf7-1a47df0367ff",
    "toolCall": {
      "toolCallId": "tooluse_KzQPRMhH6QYtQdcV74o66m",
      "title": "Running: node --version"
    },
    "options": [
      { "optionId": "allow_once",   "name": "Yes",    "kind": "allow_once" },
      { "optionId": "allow_always", "name": "Always", "kind": "allow_always" },
      { "optionId": "reject_once",  "name": "No",     "kind": "reject_once" }
    ],
    "_meta": {
      "trustOptions": [
        { "label": "Full command", "display": "node --version", "patterns": ["node \\-\\-version"] },
        { "label": "Base command", "display": "node *",         "patterns": ["node( .*)?"] }
      ]
    }
  }
}
```

`toolCall` contains **only** `toolCallId` and `title` — no `kind`, no
`rawInput`. The command lives in the earlier `tool_call` notification sharing the
same `toolCallId`:

```json
{
  "method": "session/update",
  "params": {
    "sessionId": "e152157f-...",
    "update": {
      "sessionUpdate": "tool_call",
      "toolCallId": "tooluse_KzQPRMhH6QYtQdcV74o66m",
      "title": "Running: node --version",
      "kind": "execute",
      "rawInput": {
        "__tool_use_purpose": "Run node --version as requested by the user",
        "command": "node --version"
      },
      "_meta": { "kiro": { "toolName": "shell" } }
    }
  }
}
```

**Consequences for the implementation:**

1. The Bridge keeps a `ToolCallRegistry` (`acp/toolcalls.ts`) mapping
   `toolCallId` → `{ kind, rawInput, title, kiroToolName }`, populated from
   `tool_call` / `tool_call_update`, and merges it into the permission request.
   Without this, `toolInput` reaches the clients as `undefined` and the policy
   engine has no command to match.
2. `_meta.kiro.toolName` (e.g. `"shell"`) is the real tool identifier and is what
   policy rules match on. The ACP `kind` (`"execute"`) is the fallback.
3. Option ids are **snake_case** (`allow_once`, `reject_once`). Never assume
   hyphenated ids. Always resolve via the semantic `kind` field.

**Response shape:**

```json
{ "jsonrpc": "2.0", "id": "5aa73b0d-...", "result": { "outcome": { "outcome": "selected", "optionId": "allow_once" } } }
```

Or on cancellation: `{ "outcome": { "outcome": "cancelled" } }`.

### A6 — Advertised capabilities ✅

```json
{
  "protocolVersion": 1,
  "agentCapabilities": {
    "loadSession": true,
    "promptCapabilities": { "image": true, "audio": false, "embeddedContext": false },
    "mcpCapabilities": { "http": true, "sse": false },
    "sessionCapabilities": {},
    "auth": {}
  },
  "authMethods": [],
  "agentInfo": { "name": "Kiro CLI Agent", "title": "Kiro CLI Agent", "version": "2.18.1" }
}
```

### A7 — Kiro extensions ✅

Namespaced `_kiro.dev/`, safely ignorable. Observed in traces:
`_kiro.dev/subagent/list_update`, `_kiro.dev/commands/available`,
`_kiro.dev/metadata`, `_kiro.dev/session/update`. All fall through to
`event.kind: "unknown"` with the payload preserved (AC1.3.5).

### A8 — CLI hooks ✅ investigated — notification only, cannot approve

Agent configs (`~/.kiro/agents/*.json`, `.kiro/agents/*.json`) accept a `hooks`
map. Verified event names: `agentSpawn`, `userPromptSubmit`, `preToolUse`,
`postToolUse`, `stop`. Entries take `{ matcher?, command, description? }`.

This was investigated because it is the only candidate mechanism for surfacing
approvals from a `kiro-cli chat` session that the Bridge did **not** spawn.

**What works.** A `preToolUse` hook does fire in an ordinary chat session, and
receives real detail on stdin:

```json
{
  "hook_event_name": "preToolUse",
  "cwd": "C:\\Users\\jpf\\Desktop\\kiro hack",
  "tool_name": "execute_cmd",
  "tool_input": { "command": "node --version", "summary": "Check the installed Node.js version" }
}
```

`KIRO_SESSION_ID` is present in the hook's environment. The parent environment is
**not** inherited, so a hook cannot be configured through env vars.

**The CLI blocks while the hook runs.** A hook stalled for 9s produced a 14s
total turn, and the CLI showed `0 of 1 hooks finished` throughout. So a hook can
wait on something slow — a watch tap, for instance.

**But a hook cannot deny a tool.** This contradicts the documentation, which
describes `exit 2` as blocking. On kiro-cli 2.18.1:

- Any non-zero exit is reported as `failed with exit code: 1` regardless of the
  actual code, with stderr captured and shown.
- The tool then **runs anyway**. Verified with `exit 1` and `exit 2` under
  `--trust-all-tools`: `node --version` executed and returned `v24.12.0` both
  times, after the hook was reported as failed.
- What does block an untrusted tool is unrelated to hooks: in `--no-interactive`
  mode the CLI rejects it with `non-interactive mode (no user to approve)`.

**Consequence for Aibou.** Hooks can tell us that an external session is about to
use a tool, and can stall it, but the decision still belongs to the terminal
prompt. Rendering Approve/Deny buttons for such an event would show a control
that does not control anything, which the honesty rule in context.md §6 forbids.

Aibou therefore owns the sessions it gates. For a terminal experience whose
approvals *are* answerable on the watch, use `aibou chat`, which drives the
Bridge's own ACP agent under the same signed-in Kiro account.

### A8b — Kiro **IDE** `preToolUse` hooks ⚠️ gate correctly, but stdin never ends

A8 above concerns `kiro-cli chat`. Kiro IDE hooks (`.kiro/hooks/*.kiro.hook`) are
a **different mechanism with a different contract**, and the difference cost a
working feature. Both halves below were observed directly.

**The gate works.** Unlike the CLI, an IDE `preToolUse` hook genuinely decides the
call. The agent is shown the hook's stdout and exit code, and is instructed that a
non-zero exit means the tool must not run. Verified: exit 0 → the command
proceeded; a failed hook → the call was withheld. This is exactly the contract the
approval design needed.

**But stdin never reaches EOF.** The IDE gives the hook process a stdin that is not
a TTY and is never closed. So the idiomatic read:

```js
for await (const chunk of process.stdin) data += chunk;   // never returns
```

hangs forever. It is not slow, it does not partially work — the loop simply never
ends, so no code after it ever runs.

Combined with `"timeout": 0` in the hook config (meaning *no limit*), this
produced an unkillable hook: every shell command in the editor blocked
indefinitely, no approval was ever raised, and the watch showed nothing. Observed
as a 35-minute hang ending in `Command timed out with no output captured`,
exit `-1`.

**Consequences.**

- Never read an IDE hook's stdin to EOF. Race it against a short deadline, or do
  not read it at all.
- Never set `"timeout": 0` on a hook that can block. The IDE's own timeout is the
  only backstop against a wedged editor.
- A hook that fails *open* still has to reach the code that fails open. This one's
  fail-open path and its `AbortController` were both correct and both unreachable,
  which is why the bug read as "the Bridge is down" rather than "the hook hung".

The tool name and command are only available on that stdin, so without it a hook
cannot say *what* it is about to run. Since a summary is the entire point of a
watch approval, the hook was removed rather than shipped showing "some tool".
Real-time approvals now come from the Bridge's own ACP session, where the detail
is delivered by the agent and a deny genuinely blocks — see
`scripts/watch-live.mjs` and `scripts/verify-watch-live.mjs`.

### A9 — Token / context usage ✅ **available**

Contrary to the original assumption, real usage **is** exposed, via the
`usage_update` session update:

```json
{ "sessionUpdate": "usage_update", "used": 53000, "size": 200000, "cost": { "amount": 0.045, "currency": "USD" } }
```

`used` and `size` are token counts; `cost` is optional with an ISO 4217
currency. The Bridge normalises this to `event.kind: "usage"` and forwards the
numbers **verbatim**. It never synthesises them — if the agent sends no
`usage_update`, no usage event is emitted and clients render `—`.

### A10 — Cancellation ✅

`session/cancel` is a **notification**, not a request. The agent never replies to
it directly. Confirmation arrives as the pending `session/prompt` response with
`stopReason: "cancelled"`.

Treating it as a request would leave the caller awaiting a response that never
comes.

---

## Prompt turn lifecycle (as observed)

```
client → session/prompt (id=N)            request, stays open for the whole turn
agent  → session/update tool_call         full rawInput + _meta.kiro.toolName
agent  → session/request_permission (id=M) minimal toolCall; blocks the agent
client → response to id=M                 { outcome: { outcome, optionId } }
agent  → session/update tool_call_update  real command output
agent  → session/update agent_message_chunk × N
agent  → response to id=N                 { stopReason: "end_turn" }   ← turn ends here
```

**There is no `turn_end` notification.** End of turn is the `session/prompt`
response. `stopReason` is one of `end_turn`, `max_tokens`, `max_turn_requests`,
`refusal`, `cancelled`.

Two implementation requirements follow:

1. `session/prompt` must not be awaited before acking the client. A real turn
   takes many seconds to minutes; blocking the ack makes the UI look dead.
   Aibou acks immediately and resolves the turn asynchronously.
2. Session status must be driven to `idle` from the `stopReason`, not from a
   notification.

## Measured latencies (real agent, warm)

| Operation | Observed |
|---|---|
| `initialize` round-trip | ~2.0 s |
| `session/new` round-trip | ~3.4 s |
| First `tool_call` after prompt | ~2–4 s |
| Permission request → client frame | < 250 ms (Bridge-side) |

`session/new` taking over 3 seconds is why client-side timeouts must be generous;
a 3 s timeout fails intermittently.

## What kiro-cli asks permission for

Only some tools escalate. In testing:

- **Shell commands** (`_meta.kiro.toolName: "shell"`, `kind: "execute"`) →
  always requested permission.
- **File reads** (`kind: "read"`) → never requested permission; the agent
  self-approves, so the request never reaches Aibou's policy engine.

The policy engine can therefore only govern what the agent chooses to ask about.
This is a property of the agent, not a limitation of the policy engine, and is
stated plainly in the README.

## Reproducing

```bash
pnpm --filter @aibou/bridge build
node packages/bridge/dist/index.js --trace
node scripts/live-probe.mjs <pairing-code> "Run the shell command 'node --version'."
```

Frames are written to `~/.aibou/logs/acp-<date>.jsonl`.
