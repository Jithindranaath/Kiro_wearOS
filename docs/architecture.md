# Architecture — Aibou

## System Overview

```
┌──────────────────────── Developer's Machine ─────────────────────────┐
│                                                                       │
│   kiro-cli (ACP agent)          Aibou Bridge (Node.js)                │
│   ┌──────────────────┐          ┌─────────────────────────────────┐   │
│   │  agent harness   │◄────────►│ AcpClient   (JSON-RPC / stdio)  │   │
│   │  tools, sessions │  stdio   │ SessionMgr  (state, ring buffer)│   │
│   └──────────────────┘          │ PolicyEngine(allow/deny/escalate)│   │
│                                 │ ApprovalMgr (held ACP requests) │   │
│                                 │ HttpApi     (pair, audit, static)│   │
│                                 │ WsHub       (AWP fan-out)       │   │
│                                 └────────────┬────────────────────┘   │
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

## Data Flow — Permission Request (The Critical Path)

```
1. Agent calls a tool that requires permission
2. ACP sends session/request_permission (JSON-RPC request with id)
3. Bridge PolicyEngine evaluates:
   - allow → respond immediately, emit permission.resolved(policy)
   - deny  → respond immediately, emit permission.resolved(policy)
   - escalate → hold the response open
4. Bridge creates PendingApproval, broadcasts permission.request to all clients
5. Watch vibrates, wakes screen, shows summary + Approve/Deny
6. User taps Approve
7. Client sends permission.respond frame
8. Bridge responds to the held ACP request with allow-once
9. Agent continues execution
```

## Module Map

```
packages/bridge/src/
├── index.ts            # CLI arg parsing, entry point
├── bridge.ts           # Orchestrator — wires all components
├── acp/
│   ├── client.ts       # JSON-RPC 2.0 over stdin/stdout
│   ├── methods.ts      # Typed wrappers for ACP methods
│   └── normalize.ts    # ACP frames → AWP events
├── session/
│   ├── manager.ts      # Session registry, status derivation
│   └── ringbuffer.ts   # Circular event buffer (500 events)
├── policy/
│   ├── engine.ts       # Rule evaluation (deny > escalate > allow)
│   └── defaults.ts     # Shipped default policy rules
├── approval/
│   └── manager.ts      # Pending approvals, timeout, resolution
└── server/
    ├── auth.ts         # Pairing codes, tokens, rate limiting
    ├── http.ts         # Fastify: /api/pair, /api/health, static PWA
    └── ws.ts           # WebSocket hub: auth, subscribe, fan-out
```

## Key Design Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Bridge hosts Kiro as ACP subprocess | Only the ACP host owns the permission flow |
| D2 | TypeScript for Bridge + Protocol + PWA | One language, shared types across 3 packages |
| D3 | PWA instead of native mobile apps | Covers both platforms, runs from a URL |
| D4 | Wear OS standalone (direct WebSocket) | No phone companion requirement |
| D5 | In-memory ring buffer, no database | Fewer moving parts, nothing to migrate |
| D6 | Policy engine in v1 | Core differentiator vs Kiro for iOS |

## Status Derivation

| Status | Source | How Derived |
|---|---|---|
| awaiting_permission | observed | ≥1 pending approval |
| working | observed | Prompt sent, no turn_end received |
| idle | observed | turn_end received |
| awaiting_input | **inferred** | Turn ended with trailing `?`, no tool call |
| error | observed | ACP error frame |
| disconnected | observed | Child process exited |

See `docs/status-inference.md` for heuristic details and failure modes.
