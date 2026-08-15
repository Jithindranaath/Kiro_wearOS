# architecture.md — Aibou

> Prerequisites: `context.md`, then `specs.md`.
> **Nothing in this document is a suggestion.** Where a version, path, name, or code is specified, use exactly that. Where you must deviate, record it in `context.md` §10 with a rationale.

---

## 1. System shape

```
┌──────────────────────── Developer's machine ─────────────────────────┐
│                                                                       │
│   kiro-cli (ACP agent)          Aibou Bridge (Node)                   │
│   ┌──────────────────┐          ┌─────────────────────────────────┐   │
│   │  agent harness   │◄────────►│ AcpClient   (JSON-RPC / stdio)  │   │
│   │  tools, sessions │  stdio   │ SessionMgr  (state, ring buffer)│   │
│   └──────────────────┘          │ PolicyEngine(allow/deny/escalate)│  │
│           │                     │ ApprovalMgr (held ACP requests) │   │
│   ┌───────▼──────────┐   HTTP   │ HttpApi     (pair, audit, static)│  │
│   │ CLI hooks (opt.) ├─────────►│ WsHub       (AWP fan-out)       │   │
│   └──────────────────┘  POST    └────────────┬────────────────────┘   │
│                                              │ 127.0.0.1:8787         │
└──────────────────────────────────────────────┼────────────────────────┘
                                               │ WebSocket (AWP) + HTTP
                          ┌────────────────────┴────────────────────┐
                          │                                         │
                   ┌──────▼───────┐                        ┌────────▼────────┐
                   │  PWA (React) │                        │ Wear OS (Kotlin)│
                   │  full surface│                        │  glanceable     │
                   └──────────────┘                        └─────────────────┘
```

**Key property:** the Bridge is the ACP *client*. It owns the session, therefore it owns the permission flow. Observation-only designs (hook tailing, TUI scraping) cannot approve anything. This is decision D1 and it is not negotiable.

CLI hooks are a **secondary enrichment channel only** (R1.3, A8). Nothing P0 may depend on them.

---

## 2. Repository layout

```
aibou/
├── .kiro/
│   ├── specs/aibou/{requirements.md,design.md,tasks.md}
│   ├── steering/{conventions.md,testing.md,security.md}
│   └── hooks/on-save-verify.json
├── packages/
│   ├── protocol/          # AWP types + zod schemas. Zero runtime deps beyond zod.
│   ├── bridge/            # the daemon
│   ├── pwa/               # React client
│   └── mock-agent/        # fake ACP agent for tests + demo mode
├── wear/                  # standalone Gradle project (not in pnpm workspace)
├── docs/
├── scripts/
├── Makefile
├── pnpm-workspace.yaml
└── README.md
```

`packages/protocol` is the single source of truth for wire types. Bridge and PWA import it. The Wear app mirrors it in Kotlin data classes — **when you change `protocol`, you must update the Kotlin mirror in the same commit.**

---

## 3. Stack — pinned

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js ≥ 20.11 | `engines` field enforced; `.nvmrc` committed. |
| Package manager | pnpm 9 workspaces | Lockfile committed. |
| Language | TypeScript 5.x, `"strict": true` | No `any` outside a documented ACP-boundary adapter. |
| Validation | `zod` | Every inbound frame parsed, never cast. |
| HTTP/WS | `fastify` + `@fastify/websocket` | Also serves the built PWA statically. |
| Bridge tests | `vitest` | |
| PWA | React 18 + Vite 5 + TypeScript + Tailwind | |
| PWA state | TanStack Query for HTTP, plain reducer for the WS stream | No Redux. |
| Wear | Kotlin, Compose for Wear OS, minSdk 30, targetSdk 34 | Wear OS 4/5, Galaxy Watch 4+. |
| Wear networking | OkHttp `WebSocket` + `kotlinx.serialization` | |
| Wear storage | `EncryptedSharedPreferences` | |
| Wear STT | `RecognizerIntent.ACTION_RECOGNIZE_SPEECH` | On-device, no cloud key. |

**Do not add a database.** Config and policy are JSON files under `~/.aibou/`; events are in memory (D5).

---

## 4. Bridge modules

```
packages/bridge/src/
├── index.ts            # arg parsing, wiring, graceful shutdown
├── acp/
│   ├── client.ts       # JSON-RPC 2.0 framing over stdio
│   ├── methods.ts      # thin typed wrappers; ONLY file that names ACP methods
│   └── normalize.ts    # ACP frames -> AWP events. The adapter boundary.
├── session/
│   ├── manager.ts      # registry, lifecycle, status derivation
│   └── ringbuffer.ts   # 500-event per-session buffer, monotonic seq
├── policy/
│   ├── engine.ts       # allow | deny | escalate
│   ├── rules.ts        # rule types + matching
│   └── defaults.json   # shipped default policy
├── approval/
│   └── manager.ts      # held ACP requests, timeout, idempotent resolution
├── server/
│   ├── http.ts         # /api/pair, /api/health, /api/audit, static PWA
│   ├── ws.ts           # AWP hub: auth, subscribe, fan-out, heartbeat
│   └── auth.ts         # pairing codes, tokens, constant-time compare
└── util/{log.ts,paths.ts,errors.ts}
```

**Isolation rule:** `acp/methods.ts` and `acp/normalize.ts` are the *only* files permitted to know ACP's shape. When the verify step (context §8) discovers a real method name differs from the assumption, exactly two files change.

---

## 5. AWP — the Aibou Wire Protocol

JSON over a single WebSocket at `/ws`. Every frame:

```ts
type Frame = { v: 1; t: string; id?: string; ts: number; /* ...payload */ };
```

`id` is a client-generated correlation id, echoed on the reply.

### 5.1 Client → Server

| `t` | Payload | Notes |
|---|---|---|
| `auth` | `{ token: string }` | Must be first frame. R3.2.5 |
| `subscribe` | `{ sessionId?: string; since?: number }` | Omit `sessionId` for all sessions. |
| `session.create` | `{ cwd: string }` | |
| `session.list` | `{}` | |
| `prompt.send` | `{ sessionId: string; text: string; source: "text" \| "voice" }` | |
| `permission.respond` | `{ approvalId: string; decision: "allow" \| "deny"; remember?: boolean }` | |
| `session.interrupt` | `{ sessionId: string }` | |
| `policy.get` / `policy.set` | `{}` / `{ policy: Policy }` | P1 |
| `pong` | `{}` | |

### 5.2 Server → Client

| `t` | Payload |
|---|---|
| `hello` | `{ bridgeVersion, protocolVersion: 1, mode: "live" \| "mock", capabilities: string[] }` |
| `ack` | `{ id, ok: true, result?: unknown }` |
| `error` | `{ id?, code: AibouErrorCode, message: string, retryable: boolean }` |
| `session.state` | `{ sessionId, cwd, status, statusSource: "observed" \| "inferred", statusReason?, pendingApprovals: number, lastActivity }` |
| `event` | `{ sessionId, seq, kind, payload }` |
| `permission.request` | `{ approvalId, sessionId, toolName, summary, toolInput, riskTier: "low" \| "medium" \| "high", expiresAt }` |
| `permission.resolved` | `{ approvalId, decision: "allow" \| "deny", resolution: "user" \| "policy" \| "timeout", resolvedBy?, ruleId? }` |
| `heartbeat` | `{}` |

### 5.3 Event kinds

`agent.text` · `agent.thought` · `tool.start` · `tool.end` · `task.update` · `usage` · `session.error` · `unknown`

`unknown` is mandatory (AC1.3.5). ACP frames we do not recognise are preserved verbatim rather than dropped or crashed on.

### 5.4 Error codes

```
AIBOU_UNAUTHORIZED · AIBOU_BAD_CWD · AIBOU_SESSION_LIMIT · AIBOU_SESSION_NOT_FOUND
AIBOU_ALREADY_RESOLVED · AIBOU_APPROVAL_NOT_FOUND · AIBOU_UNSUPPORTED
AIBOU_AGENT_DOWN · AIBOU_RATE_LIMITED · AIBOU_BAD_FRAME · AIBOU_INTERNAL
```

Exit codes: `78` agent unavailable · `98` port in use · `1` unhandled.

### 5.5 The `summary` field

`permission.request.summary` is what the watch renders. Rules:
- ≤ 80 characters, single line, no ANSI.
- Shell commands: first 80 chars of the command, ellipsised.
- File writes: `write <basename>` plus `(outside cwd)` when applicable.
- Never truncate mid-escape-sequence.
- The full `toolInput` always accompanies it for the PWA.

---

## 6. Permission flow — the critical path

```
agent                 Bridge                       clients
  │  request_permission  │                            │
  ├─────────────────────►│                            │
  │                      │ PolicyEngine.evaluate()    │
  │                      │                            │
  │        ┌─────────────┴──────────────┐             │
  │        │ allow / deny               │             │
  │        │  → answer immediately      │             │
  │        │  → emit permission.resolved (resolvedBy:"policy")
  │        └─────────────┬──────────────┘             │
  │                      │ escalate                   │
  │                      │ hold ACP response          │
  │                      │ store PendingApproval      │
  │                      ├─── permission.request ────►│  buzz
  │                      │                            │
  │                      │◄── permission.respond ─────┤  tap
  │◄─── answer ──────────┤                            │
  │                      ├─── permission.resolved ───►│  all clients dismiss
```

**Invariants — enforce with tests:**
1. Exactly one ACP answer per request, ever. Second responder gets `AIBOU_ALREADY_RESOLVED`.
2. A held request always terminates: user response, or timeout → deny. Never leaks.
3. Client disconnection never resolves an approval. Pending state survives and is replayed on resubscribe.
4. `deny` beats `allow` on rule conflict, always.
5. Unmatched → `escalate`. Fail closed.
6. Every resolution emits `permission.resolved`, including policy auto-resolutions, so the audit trail has no holes.

---

## 7. Policy model

```ts
type Rule = {
  id: string;
  when: {
    tool?: string | string[];          // exact or glob, e.g. "fs_*"
    pathIn?: "cwd" | "outside_cwd" | string;
    pathMatches?: string;              // glob
    commandMatches?: string;           // regex source, anchored by engine
  };
  then: "allow" | "deny" | "escalate";
  reason: string;                      // shown in UI and audit log
};

type Policy = { version: 1; rules: Rule[] };
```

Evaluation: collect **all** matching rules → any `deny` wins → else any `escalate` wins → else `allow` → else (nothing matched) `escalate`.

Shipped defaults, in `policy/defaults.json`:
- `allow` read-only tools (`fs_read` and equivalents, per verified tool names).
- `allow` writes where `pathIn: "cwd"`.
- `escalate` writes where `pathIn: "outside_cwd"`.
- `escalate` any command matching the dangerous list: `rm -rf`, `sudo`, `curl|wget` piped to a shell, `git push --force`, `chmod 777`, `dd`, `mkfs`, `> /dev/`, package publish commands.
- `escalate` any path matching the secret list: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.aws/*`, `.ssh/*`, `*credentials*`.
- `deny` anything writing to `~/.aibou/` — no self-modification.

Lists are data (AC2.2.8) and carry a test table of ≥ 20 positives and ≥ 10 negatives.

---

## 8. Status derivation

| Status | Source | Rule |
|---|---|---|
| `awaiting_permission` | observed | ≥ 1 pending approval. |
| `working` | observed | Prompt sent, no turn-end signal received. |
| `idle` | observed | Turn-end signal received. |
| `awaiting_input` | **inferred** | Turn ended with a trailing interrogative and no tool call in the final segment. |
| `error` | observed | ACP error frame or agent stderr. |
| `disconnected` | observed | Child process exited. |

Any status with `statusSource: "inferred"` must render with an `inferred` marker in both clients and be documented in `docs/status-inference.md` with its failure modes (AC1.4.3, AC1.4.4). This is a rules-compliance requirement, not polish — see `context.md` §6.

---

## 9. Mock agent

`packages/mock-agent` is a standalone executable implementing the verified ACP subset. It is selected by `AIBOU_KIRO_BIN=node packages/mock-agent/dist/index.js` or `--mock`.

It must be **scriptable**: a JSON scenario file drives a timed sequence of events, so tests and the demo can deterministically reproduce, among others, `scenarios/happy-path.json`, `scenarios/permission-escalation.json`, `scenarios/agent-crash.json`, `scenarios/slow-agent.json`.

When mock mode is active the Bridge sets `hello.mode = "mock"` and every client displays the mock banner (`context.md` §6.4). **The banner is not optional and must not be suppressible.**

---

## 10. Wear OS

```
wear/app/src/main/java/dev/aibou/wear/
├── MainActivity.kt
├── data/{AibouClient.kt,TokenStore.kt,Models.kt}
└── ui/{PairScreen.kt,StatusScreen.kt,ApprovalScreen.kt,VoiceScreen.kt,theme/}
```

- Standalone (D4). `android:usesCleartextTraffic` permitted **only** for the `10.0.2.2` and RFC1918 dev path, gated behind a debug network-security-config. Document this.
- `AibouClient` holds the OkHttp WebSocket, auto-reconnects with the backoff in AC3.3.2, and exposes a `StateFlow<UiState>`.
- Approval screen: `summary` at ≥ 16 sp, Approve and Deny as full-width `Chip`s ≥ 48 dp tall, separated vertically to prevent mis-taps. Vibrate on arrival via `Vibrator`.
- Interrupt requires a confirm swipe (AC5.1.6).
- Emulator: the Bridge on the host is `10.0.2.2:8787` from inside the emulator. **This one line belongs in the README quickstart** — it is the most likely judge-facing failure.

---

## 11. Failure handling matrix

| Failure | Behaviour |
|---|---|
| `kiro-cli` not found | Exit 78, print resolved path + `AIBOU_KIRO_BIN` hint. |
| Agent crashes mid-session | Sessions → `disconnected`, broadcast, 3 respawns (1/2/4 s), then exit. |
| Unparseable ACP frame | Emit `event.kind: "unknown"`, log, continue. Never crash. |
| Malformed `policy.json` | Log, fall back to paranoid, do not exit. |
| Client disconnects mid-approval | Approval persists; replayed on resubscribe. |
| Two clients answer same approval | First wins; second gets `AIBOU_ALREADY_RESOLVED`. |
| Port in use | Exit 98 naming the port. |
| Watch loses Wi-Fi | Auto-reconnect, resubscribe with last `seq`, replay missed events. |
| Approval timeout | Deny, `resolution: "timeout"`, audit entry. |

---

## 12. Performance budget

| Path | Budget |
|---|---|
| ACP permission request → `permission.request` on the wire | < 250 ms |
| Watch tap → ACP answer sent | < 300 ms |
| ACP `session/update` → client render | < 500 ms |
| Bridge idle memory | < 150 MB |
| Wear cold start → status visible | < 2 s |

---

## 13. Build and run

```bash
make setup     # pnpm install; build protocol
make dev       # bridge (watch) + pwa (vite) concurrently
make demo      # bridge --mock + built PWA on :8787  ← the judge path
make test      # vitest, all packages
make check     # lint + typecheck + test
make wear      # assembleRelease -> wear/app/build/outputs/apk/release/
```

`make demo` must work from a clean clone with no Kiro credentials (AC6.2.2).

---

## 14. Conventions

- Conventional Commits.
- No `any` outside `acp/normalize.ts`, and there it must carry a comment naming the ACP shape being adapted.
- Every inbound frame is `zod`-parsed. Never `as`.
- Errors are typed `AibouError` with a code from §5.4. No bare `throw new Error("...")` on a user-reachable path.
- Structured JSON logging; never log tokens, and never log `toolInput` at info level.
- One export per file for components; colocate tests as `*.test.ts`.