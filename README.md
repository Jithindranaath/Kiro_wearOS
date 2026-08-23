# ⛩️ Aibou

**Remote control for your locally running Kiro agent session.**

When your AI coding agent stalls waiting for permission, Aibou sends the approval request to your phone or watch. One tap, and the agent continues. You never went back to your desk.

---

## How this differs from Kiro for iOS

Kiro for iOS was announced on **17 June 2026** at the AWS Summit in New York. It supervises sessions running in **AWS cloud sandboxes** — Kiro's own announcement describes "cloud sessions that never stop", running "independently in the cloud" with no desktop left awake. It cannot reach a Kiro session running on your own machine.

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

A documented, working starting point is committed at
[`examples/policy.example.json`](examples/policy.example.json) — copy it to
`~/.aibou/policy.json` to use it. Its behaviour is covered by tests
(`policy/example.test.ts`), so the example cannot drift from the engine.
The Bridge prints which policy is active on startup.

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

# Unit tests — 202 tests across policy engine, example config, session
# manager, auth, ring buffer, ACP normaliser and tool-call correlation
pnpm --filter @aibou/bridge test
```

Integration suites run against a live Bridge. Start it, note the 6-digit code
printed in the terminal, then in a second terminal:

```bash
pnpm run demo                          # terminal 1

node scripts/module-test.mjs <code>    # 67 assertions: every module + integration
node scripts/pwa-flow-test.mjs <code>  # 20 assertions: exact PWA frame sequence
```

Replace `<code>` with the 6-digit pairing code — it changes on every start.

Timing-dependent behaviour needs a Bridge with a shortened approval timeout.
**Run this against a freshly started Bridge**, since it creates sessions up to
the cap:

```bash
node packages/bridge/dist/index.js --mock --approval-timeout 6000 --max-sessions 3
node scripts/runtime-test.mjs <code> 6000   # 16 assertions, takes ~60s
```

It waits out real timers, so the ~60 s runtime is expected, not a hang.

To drive a **real** Kiro session and watch the frames:

```bash
pnpm run build
node packages/bridge/dist/index.js --trace
node scripts/live-probe.mjs <code> "Run the shell command 'node --version'."
```

Raw ACP frames are written to `~/.aibou/logs/acp-<date>.jsonl`.

Current status:

| Check | Result |
|---|---|
| Build | 4/4 packages |
| Typecheck | 4/4 packages |
| Unit tests | 202/202 |
| Module + integration | 67/67 |
| PWA frame contract | 20/20 |
| Runtime timing | 16/16 |
| Wear OS build | debug + signed release, 0 warnings |
| Wear OS lint | 0 errors |

The TypeScript side is verified against both the mock agent and real `kiro-cli`
2.18.1. The Wear OS app compiles and lints clean but has **not** been exercised
on a device — see Known Limitations.

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

- **Wear OS app is not runtime-verified.** It compiles clean and passes lint with
  zero errors, and its networking mirrors the PWA client that *is* verified
  end-to-end. But haptics, screen wake, the pairing keypad, auto-reconnect and
  the Keystore round-trip have not been exercised on a physical watch or
  emulator. Treat the watch as the least-proven surface.
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

## Costs, Accounts and Rate Limits

**Aibou itself is free and has no paid dependencies, no hosted backend, and makes
no third-party API calls.** Everything runs on your own machine.

| Path | Account needed | Cost |
|---|---|---|
| **Mock mode** (`pnpm run demo`) | None | Free |
| **Live mode** (real Kiro session) | A logged-in Kiro CLI (`kiro-cli login`) | Uses your own Kiro plan |

**Reviewers do not need a Kiro account.** Mock mode exercises the entire stack —
Bridge, policy engine, approval interception, PWA and watch — using a bundled
fake ACP agent. No credentials, no payment, no sign-up.

Rate limits and usage restrictions:

- **Kiro CLI (live mode only).** Prompt turns consume your Kiro plan's usage.
  Aibou adds no calls of its own; it forwards exactly what you type. Any limits
  are Kiro's, not Aibou's.
- **Aibou pairing endpoint.** Deliberately rate-limited by Aibou: 5 failed
  attempts per IP in 60 seconds blocks that IP for 5 minutes. This is a security
  control, not a service quota.
- **Sessions.** Capped at 4 concurrent by default (`--max-sessions`).
- **Events.** 500 retained per session for replay (`--event-buffer`).
- **No telemetry, analytics or crash reporting.** Aibou makes no outbound network
  requests other than the local WebSocket between the Bridge and your clients.

### Test credentials

There are no accounts and no logins. Authentication is a **6-digit pairing code
printed by the Bridge on startup**, which is different every run, so no static
credential can be published here. Read it from the terminal and enter it in the
PWA or on the watch. It expires after 10 minutes; restart the Bridge for a new one.

---

## Third-Party Attribution

All dependencies are used under their own open-source licences. No datasets,
fonts, images, audio or trademarked assets are bundled. Icons are Unicode
emoji. Kiro and AWS are trademarks of Amazon.com, Inc. — referenced only to
describe interoperability; this project is unaffiliated.

**Bridge (Node.js)**

| Library | Licence | Use |
|---|---|---|
| [Fastify](https://fastify.dev/) + `@fastify/websocket`, `@fastify/static` | MIT | HTTP and WebSocket server, static PWA hosting |
| [zod](https://zod.dev/) | MIT | Runtime validation of every inbound frame |
| [ws](https://github.com/websockets/ws) | MIT | WebSocket transport (via Fastify) and test clients |
| [qrcode-terminal](https://github.com/gtanner/qrcode-terminal) | Apache-2.0 | Pairing QR code in the terminal |
| [nanoid](https://github.com/ai/nanoid) | MIT | Short identifiers |

**PWA (browser)**

| Library | Licence | Use |
|---|---|---|
| [React](https://react.dev/) + React DOM | MIT | UI |
| [Vite](https://vite.dev/) + `@vitejs/plugin-react` | MIT | Build tooling |
| [Tailwind CSS](https://tailwindcss.com/), PostCSS, Autoprefixer | MIT | Styling |

**Wear OS (Kotlin)**

| Library | Licence | Use |
|---|---|---|
| [Compose for Wear OS](https://developer.android.com/training/wearables/compose) (`wear.compose.*`) | Apache-2.0 | Watch UI and navigation |
| [Jetpack Compose](https://developer.android.com/compose) (BOM, ui, foundation), `activity-compose`, `lifecycle-runtime-compose`, `core-ktx` | Apache-2.0 | UI runtime |
| [OkHttp](https://square.github.io/okhttp/) | Apache-2.0 | WebSocket and HTTP client |
| [kotlinx.serialization](https://github.com/Kotlin/kotlinx.serialization), [kotlinx.coroutines](https://github.com/Kotlin/kotlinx.coroutines) | Apache-2.0 | JSON and concurrency |

**Toolchain**

TypeScript, Vitest, tsx, pnpm (all MIT); Gradle (Apache-2.0); Android Gradle
Plugin and Kotlin (Apache-2.0); OpenJDK 17 (GPL-2.0-with-classpath-exception).

**Protocols and specifications**

| Spec | Owner | Use |
|---|---|---|
| [Agent Client Protocol v1](https://agentclientprotocol.com/) | Zed Industries | The protocol Aibou speaks to `kiro-cli acp`. Documented behaviour verified against the real agent — see [docs/acp-findings.md](docs/acp-findings.md). |
| Kiro CLI ACP surface | AWS / Kiro | Host process (`kiro-cli acp`). Not bundled or redistributed. |

Token encryption on the watch uses the platform Android Keystore. AWP (the
Bridge↔client protocol) is original to this project.

---

## How Kiro Was Used

Aibou was specced and built in Kiro, using Kiro's own hooks and ACP surfaces, to
build a tool that observes Kiro. The `.kiro/` directory at the repository root is
committed and is not gitignored.

**Specs** — `.kiro/specs/aibou/` holds the `requirements.md`, `design.md` and
`tasks.md` that drove the build. Scope was fixed before implementation started,
which is why the phase boundaries in `tasks.md` map one-to-one onto the commit
history rather than being written up afterwards.

**Steering** — `.kiro/steering/` carried the conventions Kiro applied on every
turn: `conventions.md` (strict TypeScript, zod-parse every inbound frame, never
`as`-cast, ACP knowledge confined to two adapter files, fail-closed policy, never
render a value the Bridge did not receive) and `testing.md` (colocated Vitest
files, and the requirement that the policy engine carry ≥20 positive and ≥10
negative dangerous-command cases). Those rules are visible in the result: the
policy suite has 30 positive and 12 negative cases, and no production file
outside `acp/` mentions an ACP method name.

**Hooks** — `.kiro/hooks/on-save-verify.json` ran `pnpm run typecheck` on every
TypeScript save, so type breakage surfaced immediately rather than at commit time.

**Where Kiro's judgement mattered most.** Three defects were found by driving the
real agent and reading raw ACP frames, not by reading documentation:
`session/prompt` needs `prompt` rather than the documented `content` (the agent
otherwise exits silently with code 0); `session/cancel` is a notification, so
awaiting it hangs forever; and permission requests omit `rawInput`, so the
command has to be correlated from the earlier `tool_call` notification. Compiling
the Wear app surfaced five more, including a missing `<queries>` declaration that
would have permanently hidden voice input on Android 11+. All are written up in
[docs/acp-findings.md](docs/acp-findings.md).

---

## Team

Two members.

| Member | Role | Contribution |
|---|---|---|
| **Jithindranaath** | Bridge & protocol | Concept and product decisions, specs and steering. Defined the AWP frame contract in `packages/protocol` as the single source of truth, then built the Bridge on it: the ACP client that spawns and drives real `kiro-cli`, ACP→AWP normalisation, the per-session ring buffer with replay-since, and the approval manager that holds a permission request open until a human answers. Also the fail-closed policy engine, constant-time token auth with per-IP rate limiting, and the unit suite. |
| **Sri Dakshith Nimmagadda** | Clients & device verification | The Wear OS app in Kotlin and Compose — two-step pairing keypad, status screen, risk-tiered haptics, and token storage encrypted with an AES-256-GCM key held in the Android Keystore. The React PWA, including approval cards, the live event stream and the unsuppressible mock-mode banner. Drove on-device verification, including the adb-driven suites that assert an approval genuinely renders on the watch and that a real tap decides it. |

---

## License

MIT — see [LICENSE](LICENSE).
