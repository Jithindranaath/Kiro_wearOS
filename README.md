# ⛩️ Aibou

**Remote control for your locally running Kiro agent session.**

When your AI coding agent stalls waiting for permission, Aibou sends the approval request to your phone or watch. One tap, and the agent continues. You never went back to your desk.

## How this differs from Kiro for iOS

Kiro for iOS (launched June 2025) supervises sessions running in AWS cloud sandboxes. It cannot reach a Kiro session running on your own machine.

**Aibou supervises the session running on _your_ machine** — the one with your local files, your local toolchain, and your uncommitted work.

| | Kiro for iOS | Aibou |
|---|---|---|
| Session location | AWS cloud | Your laptop |
| Requires | Cloud sandbox | Local `kiro-cli` |
| Approval mechanism | In-app | Phone PWA + Wear OS watch |
| Policy engine | No | Yes — configurable rules |

## Quick Start (≤ 5 minutes)

```bash
git clone <repo-url> && cd aibou
pnpm install
pnpm run demo        # starts Bridge in mock mode on :8787
```

Open `http://localhost:8787` on your phone (same LAN). Done.

**For Wear OS emulator:** The Bridge is at `10.0.2.2:8787` from inside the emulator.

## Architecture

```
kiro-cli (ACP) ←stdin/stdout→ Aibou Bridge (Node) ←WebSocket→ Phone PWA / Wear OS Watch
                                └── Policy Engine (allow/deny/escalate)
                                └── Approval Manager (holds ACP responses)
                                └── Session Manager (ring buffer, status)
```

- **Bridge**: Spawns `kiro-cli acp` as subprocess, owns the permission flow via JSON-RPC 2.0
- **Policy Engine**: Evaluates tool calls against configurable rules. Fail-closed: unmatched = escalate.
- **Approval Manager**: Holds ACP `session/request_permission` responses until phone/watch user taps approve/deny.
- **PWA**: Full client — sessions, events, approvals, prompting
- **Wear OS**: Glanceable — approve/deny in under 3 seconds

## Current State

### ✅ Phase 1: Bridge Core (Complete)

- **ACP Client**: JSON-RPC 2.0 over stdin/stdout, request/response correlation, incoming request handling
- **Session Manager**: Create/list sessions, status derivation (observed + inferred), 500-event ring buffer with replay-since
- **Policy Engine**: Rule evaluation (deny > escalate > allow), default rules for reads/writes/shell/secrets, paranoid mode, fail-closed
- **Approval Manager**: Hold ACP permission requests, timeout → deny, idempotent resolution, summary generation
- **HTTP Server**: Fastify with `/api/pair` (6-digit code → token), `/api/health`, static PWA serving
- **WebSocket Hub**: Auth gate (5s timeout), subscribe with event replay, heartbeat (20s), fan-out to all clients
- **Auth**: 6-digit pairing code (10min TTL), CSPRNG tokens (32 bytes), constant-time comparison, rate limiting (5 attempts/60s → 5min block)
- **Tests**: 54 passing (ring buffer + policy engine with 20+ positive and 10+ negative dangerous command cases)

### 🔲 Phase 2: PWA Client (Next)
### 🔲 Phase 3: Wear OS App
### 🔲 Phase 4: Polish & Submit

## Features

| Feature | Status | Source |
|---|---|---|
| Permission interception | ✅ | Observed (ACP `session/request_permission`) |
| Policy auto-approve/deny | ✅ | Rules engine with defaults |
| Session status | ✅ | Observed + Inferred (see docs/status-inference.md) |
| Event stream with replay | ✅ | Ring buffer, monotonic seq, no gaps |
| Pairing & auth | ✅ | 6-digit code, bearer tokens, rate limiting |
| Mock mode | ✅ | For testing without Kiro credentials |
| Watch approval | 🔲 | Wear OS standalone |
| Token/credit usage | ❌ | Not exposed by ACP (honest absence, not faked) |

## Mock Mode

`pnpm run demo` starts the Bridge with `--mock`, using a fake ACP agent. This lets judges run the full stack without Kiro credentials.

When mock mode is active:
- Bridge logs a banner on startup
- WebSocket `hello` carries `mode: "mock"`
- PWA shows a persistent amber bar: **MOCK MODE — not a real Kiro session**
- Watch app shows a mock badge

## Policy Engine

Rules live in `~/.aibou/policy.json`. Default behavior:
- **Auto-allow**: read-only tools, writes inside project directory
- **Escalate**: writes outside project, dangerous shell commands, secret file access
- **Deny**: writes to `~/.aibou/` (no self-modification)
- **Fail closed**: unmatched rules always escalate to human
- **Deny wins**: if both allow and deny rules match, deny takes precedence

Use `--paranoid` to escalate everything regardless of rules.

## Built with Kiro

Aibou was specced and built in Kiro, using Kiro's own hooks and ACP surfaces, to build a tool that observes Kiro.

The `.kiro/` directory contains:
- `specs/` — Requirements, design, and tasks that drove the build
- `steering/` — Project conventions enforced during development
- `hooks/` — Typecheck-on-save hook used during development

## Project Structure

```
aibou/
├── .kiro/              # Kiro specs, steering, hooks (committed)
├── packages/
│   ├── protocol/       # AWP types + zod schemas
│   ├── bridge/         # ACP host daemon (Phase 1 ✅)
│   ├── pwa/            # React PWA client (Phase 2)
│   └── mock-agent/     # Fake ACP agent for tests
├── wear/               # Wear OS app (Phase 3)
└── docs/               # Architecture, protocol, findings
```

## Known Limitations

- No TLS — designed for trusted LAN or VPN (document Tailscale as user option)
- No background push notifications — PWA alerts require the tab to be open
- Single session only in v1
- Token/credit usage not displayed (not exposed by ACP, not faked)
- Watch app requires Wi-Fi (no Bluetooth relay through phone)

## License

MIT
