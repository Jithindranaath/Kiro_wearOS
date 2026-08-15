# specs.md — Aibou Requirements

> Prerequisite: read `context.md` in full.
> Every requirement below is **testable**. If you cannot write a test that fails before implementation and passes after, the requirement is badly written — flag it rather than guessing.
> Acceptance criteria use EARS phrasing (`WHEN <trigger> THE SYSTEM SHALL <response>`).

## Priority key

| Tag | Meaning |
|---|---|
| **P0** | Ship-blocking. Without it there is no submission. |
| **P1** | Required for a competitive submission. |
| **P2** | Build only if P0 and P1 are complete and tested. |
| **P3** | Explicitly deferred. Do not build. List in README under "Roadmap". |

---

# EPIC 1 — Bridge core (ACP host)

### R1.1 — Spawn and initialise a Kiro ACP session · **P0**

*As a developer, I want the Bridge to host a Kiro session on my machine, so that it can be observed and controlled remotely.*

- **AC1.1.1** WHEN the Bridge starts THE SYSTEM SHALL spawn the Kiro CLI ACP agent as a child process using the command verified in `docs/acp-findings.md`.
- **AC1.1.2** WHEN the child process starts THE SYSTEM SHALL send an ACP `initialize` request and store the returned capabilities.
- **AC1.1.3** IF the child process cannot be spawned (binary not found, non-zero exit within 5s) THEN THE SYSTEM SHALL exit with code `78`, print the resolved binary path, and print a remediation hint naming the `AIBOU_KIRO_BIN` env var.
- **AC1.1.4** WHEN the child process exits unexpectedly while sessions are active THE SYSTEM SHALL mark all sessions `disconnected`, broadcast `session.state`, and attempt exactly 3 respawns with 1s/2s/4s backoff before exiting.
- **AC1.1.5** THE SYSTEM SHALL write every inbound and outbound ACP frame verbatim to `~/.aibou/logs/acp-<date>.jsonl` when started with `--trace`.

### R1.2 — Session lifecycle · **P0**

- **AC1.2.1** WHEN a client sends `session.create` with a `cwd` THE SYSTEM SHALL issue ACP `session/new` and return the resulting session id.
- **AC1.2.2** IF `cwd` does not exist or is not a directory THEN THE SYSTEM SHALL reject with error code `AIBOU_BAD_CWD` and SHALL NOT spawn a session.
- **AC1.2.3** THE SYSTEM SHALL support at least 4 concurrent sessions and SHALL reject the 5th with `AIBOU_SESSION_LIMIT`.
- **AC1.2.4** WHEN a client sends `session.list` THE SYSTEM SHALL return every known session with id, cwd, status, last-activity timestamp, and pending-approval count.

### R1.3 — Event stream · **P0**

- **AC1.3.1** WHEN an ACP `session/update` notification arrives THE SYSTEM SHALL normalise it into an AWP `event` frame and broadcast it to all subscribed, authenticated clients within 250 ms.
- **AC1.3.2** THE SYSTEM SHALL retain the most recent 500 events per session in an in-memory ring buffer.
- **AC1.3.3** WHEN a client subscribes with `since: <seq>` THE SYSTEM SHALL replay buffered events with `seq > since` before sending live events, in order, with no duplicates and no gaps.
- **AC1.3.4** THE SYSTEM SHALL assign every event a monotonically increasing per-session `seq` starting at 1.
- **AC1.3.5** IF an inbound ACP frame does not match any known shape THEN THE SYSTEM SHALL emit it as `event.kind: "unknown"` with the raw payload preserved, and SHALL NOT crash.

### R1.4 — Session status derivation · **P0**

- **AC1.4.1** THE SYSTEM SHALL expose exactly one status per session from: `idle`, `working`, `awaiting_permission`, `awaiting_input`, `error`, `disconnected`.
- **AC1.4.2** WHEN a permission request is outstanding THE SYSTEM SHALL report `awaiting_permission` and SHALL set `statusSource: "observed"`.
- **AC1.4.3** IF a status is derived by heuristic rather than an explicit ACP signal THEN THE SYSTEM SHALL set `statusSource: "inferred"` and populate `statusReason` with a human-readable explanation.
- **AC1.4.4** THE SYSTEM SHALL document every heuristic used, and its known failure modes, in `docs/status-inference.md`.

### R1.5 — Prompting and interruption · **P0**

- **AC1.5.1** WHEN a client sends `prompt.send` THE SYSTEM SHALL forward the text via ACP `session/prompt` and acknowledge with the assigned `seq`.
- **AC1.5.2** WHEN a client sends `session.interrupt` THE SYSTEM SHALL issue the ACP cancellation verified in A10 and SHALL broadcast a `session.state` frame within 1 s.
- **AC1.5.3** IF cancellation is not supported by the connected agent THEN THE SYSTEM SHALL respond `AIBOU_UNSUPPORTED` and clients SHALL disable the interrupt control rather than showing a button that does nothing.

---

# EPIC 2 — Permission interception and policy

> This epic is the product's differentiator. It is P0 in full.

### R2.1 — Intercept and escalate · **P0**

- **AC2.1.1** WHEN the agent issues an ACP permission request THE SYSTEM SHALL hold the response open, create a pending approval record, and broadcast a `permission.request` frame within 250 ms.
- **AC2.1.2** THE `permission.request` frame SHALL include: `approvalId`, `sessionId`, `toolName`, a `summary` string of ≤ 80 characters safe to display on a watch, the full `toolInput`, and `riskTier`.
- **AC2.1.3** WHEN any authenticated client sends `permission.respond` with a matching `approvalId` THE SYSTEM SHALL answer the held ACP request accordingly and broadcast `permission.resolved` to all clients.
- **AC2.1.4** IF a second `permission.respond` arrives for an already-resolved `approvalId` THEN THE SYSTEM SHALL respond `AIBOU_ALREADY_RESOLVED` and SHALL NOT re-answer the ACP request.
- **AC2.1.5** IF no response arrives within the configured timeout (default 900 s) THEN THE SYSTEM SHALL deny the request, broadcast `permission.resolved` with `resolution: "timeout"`, and record the reason.
- **AC2.1.6** THE SYSTEM SHALL survive a client disconnecting mid-approval; the pending record persists in memory and any reconnecting client receives it in the subscribe replay.

### R2.2 — Policy engine · **P0**

*Rules live in `~/.aibou/policy.json`. Fail closed.*

- **AC2.2.1** THE SYSTEM SHALL evaluate rules against `toolName` and `toolInput` and resolve to exactly one of `allow`, `deny`, `escalate`.
- **AC2.2.2** IF no rule matches THEN THE SYSTEM SHALL resolve to `escalate`. (Fail closed.)
- **AC2.2.3** WHERE both an `allow` and a `deny` rule match, THE SYSTEM SHALL apply `deny`, regardless of rule order.
- **AC2.2.4** THE SYSTEM SHALL ship a default policy that: auto-allows read-only tools; auto-allows writes to paths inside the session `cwd`; escalates writes outside `cwd`; escalates any shell command matching the dangerous-pattern list; escalates any tool touching a path matching the secret-file list.
- **AC2.2.5** THE SYSTEM SHALL support a `--paranoid` flag that escalates everything, ignoring all `allow` rules.
- **AC2.2.6** WHEN a rule auto-resolves a request THE SYSTEM SHALL still emit a `permission.resolved` event with `resolvedBy: "policy"` and the matched rule id, so the audit trail is complete.
- **AC2.2.7** IF `policy.json` is malformed THEN THE SYSTEM SHALL log the parse error, fall back to `--paranoid` behaviour, and SHALL NOT exit.
- **AC2.2.8** Dangerous-pattern and secret-file lists SHALL be data, not code, and SHALL be unit-tested with a table of at least 20 positive and 10 negative cases.

### R2.3 — Audit trail · **P1**

- **AC2.3.1** THE SYSTEM SHALL append every permission decision to `~/.aibou/audit.jsonl` with timestamp, session, tool, input hash, resolution, and resolver.
- **AC2.3.2** THE SYSTEM SHALL expose the last 100 decisions via `GET /api/audit`.

---

# EPIC 3 — Transport, auth, pairing

### R3.1 — Server · **P0**

- **AC3.1.1** THE SYSTEM SHALL listen on `127.0.0.1:8787` by default, overridable via `--host` and `--port`.
- **AC3.1.2** WHEN started with a non-loopback `--host` THE SYSTEM SHALL print a clearly formatted warning naming the exposure risk.
- **AC3.1.3** IF the port is in use THEN THE SYSTEM SHALL exit with code `98` and a message naming the port.
- **AC3.1.4** THE SYSTEM SHALL serve the built PWA as static files from the same origin, so no CORS configuration is required for the default path.

### R3.2 — Pairing and auth · **P0**

- **AC3.2.1** WHEN the Bridge starts THE SYSTEM SHALL print a 6-digit pairing code and an ASCII QR code encoding the pairing URL.
- **AC3.2.2** WHEN a client `POST`s a valid code to `/api/pair` THE SYSTEM SHALL return a bearer token of ≥ 32 bytes of CSPRNG entropy, hex-encoded.
- **AC3.2.3** THE pairing code SHALL expire 10 minutes after printing and SHALL be regenerable via `SIGHUP` or the `--repair` flag.
- **AC3.2.4** WHEN an invalid code is submitted 5 times within 60 seconds THE SYSTEM SHALL reject further attempts from that IP for 5 minutes.
- **AC3.2.5** WHEN a WebSocket connects THE SYSTEM SHALL require an `auth` frame within 5 seconds and SHALL close the socket with code `4401` otherwise.
- **AC3.2.6** THE SYSTEM SHALL NOT send any session, event, or permission data over an unauthenticated socket.
- **AC3.2.7** Token comparison SHALL be constant-time.

### R3.3 — Liveness · **P1**

- **AC3.3.1** THE SYSTEM SHALL send a `heartbeat` frame every 20 s and SHALL close sockets that miss 3 consecutive client `pong`s.
- **AC3.3.2** Clients SHALL reconnect with exponential backoff (1s, 2s, 4s, 8s, capped at 30s) and SHALL resubscribe with their last-seen `seq`.

---

# EPIC 4 — PWA client

### R4.1 — Core · **P0**

- **AC4.1.1** THE PWA SHALL pair by entering a 6-digit code or scanning the QR, and SHALL persist its token in `localStorage`.
- **AC4.1.2** THE PWA SHALL show a session list with status, cwd basename, and a pending-approval badge.
- **AC4.1.3** THE PWA SHALL render the live event stream with tool calls, agent text, and task-list updates, auto-scrolling only when already at the bottom.
- **AC4.1.4** THE PWA SHALL show pending approvals with the full tool input, syntax-highlighted where the input is a shell command or a diff, and Approve / Deny controls.
- **AC4.1.5** THE PWA SHALL provide a prompt input and an interrupt control.
- **AC4.1.6** THE PWA SHALL display connection state and SHALL show a reconnecting indicator rather than silently failing.
- **AC4.1.7** WHEN the Bridge reports `mode: "mock"` THE PWA SHALL display a persistent amber banner reading `MOCK MODE — not a real Kiro session`.

### R4.2 — Installability and alerting · **P1**

- **AC4.2.1** THE PWA SHALL ship a valid web manifest and a service worker, and SHALL pass an installability check in Chrome DevTools.
- **AC4.2.2** WHEN a permission escalation arrives and notification permission is granted THE PWA SHALL raise a `Notification`.
- **AC4.2.3** THE README SHALL state plainly that background push is not implemented and that alerts require the tab to be open — see `context.md` §6.

### R4.3 — Deferred · **P3**

Diff-editing, file browsing, multi-machine bridge switching, theming.

---

# EPIC 5 — Wear OS client

> Design constraint: **glanceable**. Every screen readable and actionable in under 3 seconds, no scrolling required for the primary action.

### R5.1 — Core · **P0**

- **AC5.1.1** THE APP SHALL pair by entering the 6-digit code on the watch keypad, and SHALL persist the token in `EncryptedSharedPreferences`.
- **AC5.1.2** THE APP SHALL operate standalone over Wi-Fi with no phone companion app installed.
- **AC5.1.3** THE APP SHALL show a status screen: session name, status, elapsed time in current status.
- **AC5.1.4** WHEN a `permission.request` arrives THE APP SHALL vibrate, wake the screen, and show the `summary` with full-width Approve and Deny targets each ≥ 48 dp tall.
- **AC5.1.5** WHEN a permission is resolved by another client THE APP SHALL dismiss its approval screen within 1 s.
- **AC5.1.6** THE APP SHALL provide an interrupt control behind a confirmation swipe to prevent accidental triggering.
- **AC5.1.7** THE APP SHALL reconnect automatically after Wi-Fi loss without user action.

### R5.2 — Voice · **P1**

- **AC5.2.1** THE APP SHALL capture a prompt via `RecognizerIntent` and SHALL show the transcript for confirmation before sending.
- **AC5.2.2** IF speech recognition is unavailable on the device THEN THE APP SHALL hide the voice control rather than crash.

### R5.3 — Deferred · **P3**

Complications, tiles, ongoing notifications, diff viewing, Wear-to-phone handoff.

---

# EPIC 6 — Quality, docs, submission

### R6.1 — Testing · **P0**

- **AC6.1.1** A mock ACP agent package SHALL implement the verified subset of ACP and SHALL be scriptable to emit any event sequence, including permission requests.
- **AC6.1.2** Unit tests SHALL cover the policy engine, event normalisation, sequencing/replay, and auth. Line coverage on `packages/bridge/src` SHALL be ≥ 70%.
- **AC6.1.3** An integration test SHALL drive Bridge + mock agent end-to-end: create session → prompt → permission request → approve → resolution broadcast.
- **AC6.1.4** `pnpm test` SHALL pass from a clean clone with no network access beyond the install step.
- **AC6.1.5** CI SHALL run lint, typecheck, and tests on every push.

### R6.2 — Runnable by a judge · **P0**

- **AC6.2.1** A clean-machine run SHALL take a judge from `git clone` to a working UI in **≤ 5 minutes** and **≤ 4 commands**.
- **AC6.2.2** The repo SHALL provide `make demo` (or `pnpm demo`) that starts the Bridge in mock mode and serves the PWA, requiring no Kiro credentials.
- **AC6.2.3** The repo SHALL provide a signed Wear OS APK in a GitHub release, plus instructions for the Android Studio Wear emulator **including the `10.0.2.2` host-loopback mapping**, which is the single most common setup failure.
- **AC6.2.4** The setup path SHALL be executed on a machine that has never built the project, by someone who did not write it, before submission.

### R6.3 — Documentation · **P0**

Required files, all committed:

| File | Must contain |
|---|---|
| `README.md` | One-paragraph pitch; **"How this differs from Kiro for iOS"** in the first screen; quickstart ≤ 5 min; architecture diagram; feature table marking observed vs inferred; mock-mode explanation; **Kiro usage section**; known limitations. |
| `docs/architecture.md` | Rendered from `architecture.md`. |
| `docs/acp-findings.md` | Verified answers to `context.md` §8, with sample frames. |
| `docs/status-inference.md` | Every heuristic and its failure modes. |
| `docs/protocol.md` | Full AWP message reference. |
| `SECURITY.md` | Threat model, LAN exposure, token handling, policy fail-closed behaviour. |
| `CONTRIBUTING.md` | Dev setup, test commands. |
| `.kiro/` | Committed specs, steering, hooks. Not gitignored. Verify with `git check-ignore -v .kiro`. |

### R6.4 — Kiro usage evidence · **P0**

- **AC6.4.1** `.kiro/specs/` SHALL contain the spec files that actually drove the build, not documentation written afterwards.
- **AC6.4.2** `.kiro/steering/` SHALL contain the project conventions used during development.
- **AC6.4.3** `.kiro/hooks/` SHALL contain at least one working hook used during development (suggested: run typecheck + tests on file save).
- **AC6.4.4** The README SHALL state the reflexive angle explicitly: *Aibou was specced and built in Kiro, using Kiro's own hooks and ACP surfaces, to build a tool that observes Kiro.*
- **AC6.4.5** The demo video SHALL show the `.kiro` directory and at least one spec-driven build moment.

### R6.5 — Demo video · **P1**

Target 3 minutes. Required beats, in order:

1. **0:00–0:25** — The gap. "Kiro for iOS supervises cloud sessions. This is your laptop's session." Name the prior art out loud.
2. **0:25–1:15** — The money shot. Real local Kiro session, agent hits a shell command, watch buzzes, one tap, agent continues. Unbroken take, no cuts.
3. **1:15–1:45** — Policy engine: reads auto-approved, `rm` outside cwd escalated.
4. **1:45–2:20** — PWA on a phone browser; note judges can run this in 5 minutes.
5. **2:20–2:50** — `.kiro` specs, steering, hooks; the reflexive angle.
6. **2:50–3:00** — Limitations, stated honestly. Repo link.

---

# Traceability

Every task in `plan.md` must reference at least one requirement id. Any requirement with no covering task is a gap — surface it rather than dropping it silently.