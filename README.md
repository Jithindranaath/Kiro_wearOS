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
pnpm run demo        # starts Bridge in mock mode + serves PWA
```

Open `http://localhost:8787` on your phone (same LAN). Done.

**For Wear OS emulator:** The Bridge is at `10.0.2.2:8787` from inside the emulator.

## Architecture

```
kiro-cli (ACP) ←→ Aibou Bridge (Node) ←→ Phone PWA / Wear OS Watch
                   └── Policy Engine
```

- **Bridge**: Spawns `kiro-cli acp` as subprocess, owns the permission flow
- **PWA**: Full client — sessions, events, approvals, prompting
- **Wear OS**: Glanceable — approve/deny in under 3 seconds

## Features

| Feature | Status | Source |
|---|---|---|
| Permission interception | ✅ | Observed (ACP `session/request_permission`) |
| Session status | ✅ | Observed + Inferred (see docs/status-inference.md) |
| Policy engine (auto-approve/deny/escalate) | ✅ | — |
| Event stream | ✅ | Observed (ACP `session/update`) |
| Mock mode | ✅ | For testing without Kiro credentials |
| Watch approval | ✅ | Wear OS standalone |
| Token/credit usage | ❌ | Not exposed by ACP (honest absence, not faked) |

## Mock Mode

`pnpm run demo` starts the Bridge with `--mock`, using a fake ACP agent. This lets judges run the full stack without Kiro credentials.

When mock mode is active:
- Bridge logs a banner on startup
- WebSocket `hello` carries `mode: "mock"`
- PWA shows a persistent amber bar: **MOCK MODE — not a real Kiro session**
- Watch app shows a mock badge

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
│   ├── bridge/         # ACP host daemon
│   ├── pwa/            # React PWA client
│   └── mock-agent/     # Fake ACP agent for tests
├── wear/               # Wear OS app (Kotlin)
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
