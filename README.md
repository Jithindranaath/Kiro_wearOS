# ⛩️ Aibou

**Remote control for your locally running Kiro agent session.**

When your AI coding agent stalls waiting for permission, Aibou sends the approval request to your phone or watch. One tap, and the agent continues. You never went back to your desk.

---

## How this differs from Kiro for iOS

Kiro for iOS (launched June 2025 at the AWS New York Summit) supervises sessions running in **AWS cloud sandboxes**. It cannot reach a Kiro session running on your own machine.

**Aibou supervises the session running on _your_ machine** — the one with your local files, your local toolchain, and your uncommitted work.

| | Kiro for iOS | Aibou |
|---|---|---|
| Session location | AWS cloud | Your laptop |
| Requires | Cloud sandbox | Local `kiro-cli` |
| Approval mechanism | In-app | Phone PWA + Wear OS watch |
| Policy engine | No | Yes — configurable rules |
| Scope | Cloud sessions only | Local sessions only |

We did not invent mobile agent supervision. Kiro for iOS does it for cloud sessions. We extended it to the local session, which the official product does not cover (see [Kiro issue #9460](https://github.com/kirodotdev/Kiro/issues)).

---

## Quick Start (≤ 5 minutes, ≤ 4 commands)

```bash
git clone <repo-url> && cd aibou
pnpm install
pnpm --filter @aibou/protocol build
pnpm run demo
```

Open `http://localhost:8787` on your phone browser (same Wi-Fi). Enter the 6-digit code shown in the terminal. Done.

**For real Kiro sessions** (not mock mode):
```bash
pnpm --filter @aibou/pwa build
pnpm --filter @aibou/bridge start
```

**For Wear OS emulator:** The Bridge is at `10.0.2.2:8787` from inside the emulator. This is the Android emulator's host loopback — it is the most common setup failure for judges.

---

## Architecture

```
kiro-cli acp ←JSON-RPC/stdio→ Aibou Bridge ←WebSocket/AWP→ Phone PWA / Wear OS
                                 ├── Policy Engine (allow/deny/escalate)
                                 ├── Approval Manager (holds ACP responses)
                                 ├── Session Manager (ring buffer, status)
                                 └── Auth (pairing code, bearer tokens)
```

See [docs/architecture.md](docs/architecture.md) for the full system diagram and module map.

---

## Features

| Feature | Status | Data Source |
|---|---|---|
| Permission interception & approval | ✅ | Observed — ACP `session/request_permission` |
| Policy auto-approve/deny/escalate | ✅ | Rules engine with shipped defaults |
| Session status derivation | ✅ | Observed + Inferred (see below) |
| Live event stream with replay | ✅ | Observed — ACP `session/update` notifications |
| Task list | ✅ | Observed — ACP `plan` update |
| Token/context usage | ✅ | Observed — ACP `usage_update`, forwarded verbatim |
| Pairing & auth | ✅ | 6-digit code, 32-byte CSPRNG tokens |
| Watch approval (vibrate + wake) | ✅ | Wear OS standalone, ≥48dp touch targets |
| Voice prompt from watch | ✅ | RecognizerIntent with transcript confirmation |
| Browser notifications (PWA) | ✅ | Notification API on permission escalation |
| PWA installable | ✅ | Web manifest + service worker |
| Mock mode for demos/CI | ✅ | Full stack works without Kiro credentials |
| Credits / billing consumption | ❌ | Not exposed by ACP — absent, not faked |

Usage figures are shown **only** when the agent sends them. If no `usage_update`
arrives, the clients render `—` rather than a plausible-looking number.

### Observed vs. Inferred Status

| Status | Source | Note |
|---|---|---|
| awaiting_permission | Observed | ≥1 held ACP permission request |
| working | Observed | Prompt sent, no turn_end received |
| idle | Observed | turn_end received |
| awaiting_input | **Inferred** | Turn ended with `?`, no tool call in segment |
| error | Observed | ACP error frame |
| disconnected | Observed | Agent process exited |

Inferred statuses render with an `inferred` marker in both the PWA and Watch app. See [docs/status-inference.md](docs/status-inference.md) for heuristic details and known failure modes.

---

## Policy Engine

Rules live in `~/.aibou/policy.json`. Shipped defaults:

| Action | Decision |
|---|---|
| Writes to `~/.aibou/` (self-modification) | `deny` |
| Secret file access (`.env`, `*.pem`, `.ssh/`, `.aws/`, …) | `escalate` |
| Dangerous shell commands (`rm -rf`, `sudo`, `git push --force`, …) | `escalate` |
| File writes outside the project directory | `escalate` |
| Read-only tools | `allow` |
| File writes inside the project directory | `allow` |
| Anything unmatched | `escalate` (**fail closed**) |

**Deny always wins** — if both an allow and a deny rule match, deny takes
precedence regardless of order.

`--paranoid` escalates everything. A malformed `policy.json` also falls back to
paranoid mode rather than failing open, and the Bridge says so on startup.

Rules match on the agent's real tool name (`_meta.kiro.toolName`, e.g. `shell`),
falling back to the ACP tool kind (e.g. `execute`).

**One honest caveat:** the policy engine can only govern what the agent actually
asks about. `kiro-cli` requests permission for shell commands but self-approves
file reads, so reads never reach the engine. That is a property of the agent, not
a gap in the rules.

---

## Mock Mode

`pnpm run demo` starts the Bridge with `--mock`, using a fake ACP agent that replays a deterministic scenario (text → tool call → permission request). This lets anyone run the full stack without Kiro credentials.

When mock mode is active:
- Bridge prints `🟡 MOCK MODE` banner on startup
- WebSocket `hello` frame carries `mode: "mock"`
- PWA renders a persistent amber bar: **⚠️ MOCK MODE — not a real Kiro session**
- Watch app shows a mock badge on the status screen
- The mock banner is **not suppressible** — this is a competition rules compliance requirement

---

## Built with Kiro

Aibou was specced and built in Kiro, using Kiro's own hooks and ACP surfaces, to build a tool that observes Kiro.

The `.kiro/` directory contains:
- **`specs/`** — Requirements, design, and tasks that drove the build
- **`steering/`** — Project conventions enforced during development (code style, testing, security)
- **`hooks/`** — Typecheck-on-save hook used during development

---

## Project Structure

```
aibou/
├── .kiro/                  # Kiro specs, steering, hooks (committed, real)
├── packages/
│   ├── protocol/           # AWP types + zod schemas (shared source of truth)
│   ├── bridge/             # Node.js daemon — ACP host, WS server, policy
│   ├── pwa/                # React PWA — full mobile client
│   └── mock-agent/         # Fake ACP agent for tests and demo
├── wear/                   # Wear OS app — Kotlin, Compose, standalone
├── docs/                   # Architecture, protocol, ACP findings
├── scripts/                # Integration test
├── SECURITY.md             # Threat model and security posture
├── CONTRIBUTING.md         # Dev setup and commands
└── Makefile                # Build shortcuts
```

---

## Testing

```bash
# Type check every package
pnpm -r typecheck

# Unit tests — 151 tests across policy engine, ring buffer,
# ACP normaliser and tool-call correlation
pnpm --filter @aibou/bridge test
```

Integration suites run against a live Bridge. Start it, note the 6-digit code,
then in a second terminal:

```bash
pnpm run demo                          # terminal 1

node scripts/module-test.mjs <code>    # 67 assertions: every module + integration
node scripts/pwa-flow-test.mjs <code>  # 20 assertions: exact PWA frame sequence
```

To drive a **real** Kiro session and watch the frames:

```bash
pnpm run build
node packages/bridge/dist/index.js --trace
node scripts/live-probe.mjs <code> "Run the shell command 'node --version'."
```

Raw ACP frames are written to `~/.aibou/logs/acp-<date>.jsonl`.

Timing-dependent behaviour (approval timeout, heartbeat, disconnect-during-
approval, session cap) has its own suite, which needs a shortened timeout:

```bash
node packages/bridge/dist/index.js --mock --approval-timeout 6000 --max-sessions 3
node scripts/runtime-test.mjs <code> 6000
```

Current status:

| Check | Result |
|---|---|
| Build | 4/4 packages |
| Typecheck | 4/4 packages |
| Unit tests | 189/189 |
| Module + integration | 67/67 |
| PWA frame contract | 20/20 |
| Runtime timing | 16/16 |
| Wear OS build | debug + signed release, 0 warnings |
| Wear OS lint | 0 errors |

All verified against both the mock agent and real `kiro-cli` 2.18.1.

## Building the Wear OS app

```bash
cd wear
./gradlew :app:assembleDebug          # installable debug APK
./gradlew :app:assembleRelease        # release APK
./gradlew :app:lintDebug              # 0 errors expected
```

Toolchain is pinned: Gradle 9.4.1, AGP 9.2.1, Kotlin 2.4.10, JDK 17,
compileSdk 37, targetSdk 36, minSdk 30 (Wear OS 3+).

Install to a device or emulator:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**Emulator note:** the Bridge on your host is reachable at `10.0.2.2:8787` from
inside the emulator. That value is pre-filled on the pairing screen but is fully
editable, so a physical watch can point at your machine's LAN IP instead.

Release signing is optional and driven by `wear/keystore.properties` (gitignored,
see `keystore.properties.example`). Without it the release build still succeeds
and produces an unsigned APK, so cloning the repo never requires local secrets.

The token is encrypted with an AES-256-GCM key in the Android Keystore.
`androidx.security:security-crypto` is deliberately unused — it is deprecated.

## Configuration

```
--mock                     Use the bundled fake ACP agent (no Kiro credentials)
--host <addr>              Bind address                 (default 127.0.0.1)
--port <n>                 Bind port                    (default 8787)
--paranoid                 Escalate every action, ignoring allow rules
--trace                    Log all ACP frames to ~/.aibou/logs/
--approval-timeout <ms>    Auto-deny after this long    (default 900000)
--event-buffer <n>         Events retained per session  (default 500)
--max-sessions <n>         Concurrent session cap       (default 4)
--help                     Show usage

AIBOU_KIRO_BIN             Path to the kiro-cli binary
```

Invalid numeric values are rejected with a warning and fall back to the default
rather than starting in a broken state.

---

## Known Limitations

- **No TLS.** Binds to `127.0.0.1` by default; LAN binding requires an explicit
  `--host` flag and prints a warning. Use Tailscale or a VPN for remote access.
- **No background push.** PWA notifications require the tab to be open, and the
  watch app must be running. There is no server-initiated push.
- **Reads bypass the policy engine.** `kiro-cli` self-approves file reads and
  never sends a permission request for them.
- **Credits / billing not shown.** Not exposed by ACP, and not faked.
- **Wear OS needs Wi-Fi.** Standalone by design — no Bluetooth relay through a
  phone, so the watch must be on the same network as the Bridge.
- **`awaiting_input` is a heuristic.** It can produce false positives on
  rhetorical questions. Always labelled `inferred`; see
  [docs/status-inference.md](docs/status-inference.md).
- **Single-session flow.** The Bridge supports 4 concurrent sessions and the PWA
  lists them, but the UI is tuned for one at a time.
- **`session/new` is slow.** ~3.4 s against the real agent. Expected, not a hang.

## Documentation Corrections

While building this, two documented ACP behaviours turned out not to match the
shipped agent. Both are load-bearing, and both were found by tracing real frames:

1. **`session/prompt` takes `prompt`, not `content`.** Kiro's docs page shows
   `content`; the real agent requires `prompt` per the ACP v1 spec. Sending
   `content` makes the agent exit silently with code 0 — no error, no response.
2. **`session/cancel` is a notification, not a request.** Awaiting a reply hangs
   forever; confirmation arrives as the `session/prompt` response with
   `stopReason: "cancelled"`.

Full details, raw frames and measured latencies:
[docs/acp-findings.md](docs/acp-findings.md).

---

## Kiro Usage Section

This project demonstrates Kiro's spec-driven development workflow:

1. **Specs** — Requirements and design documents in `.kiro/specs/aibou/` defined the scope before implementation began
2. **Steering** — Convention files in `.kiro/steering/` enforced code style, testing standards, and security practices throughout development
3. **Hooks** — A typecheck-on-save hook in `.kiro/hooks/` ran continuous validation during development

The reflexive angle: *Aibou was specced and built in Kiro, using Kiro's own hooks and ACP surfaces, to build a tool that observes Kiro.*

---

## License

MIT
