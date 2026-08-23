# plan.md — Aibou Execution Plan

> Read `context.md`, `specs.md`, `architecture.md` first.
> **Work top to bottom.** Do not start a phase until the previous phase's gate passes.
> Every task carries requirement ids from `specs.md`. Mark `[x]` only when the acceptance criteria actually pass, not when the code compiles.

---

## 1. Timeline reality

| | |
|---|---|
| Today | **Sunday 16 August 2026** |
| Submission deadline | **Sunday 23 August 2026, 23:59 UTC** |
| Working days available | **8, including today** |
| Internal deadline | **Saturday 22 August, 23:59 local** — Sunday is video + buffer only |

*(Correction to earlier guidance: this is 8 days, not 9. The plan below is compressed accordingly.)*

---

## 2. Rules of engagement

1. **P0 before P1 before P2.** A half-finished P1 feature scores worse than a polished P0 set, because it breaks AC6.2.1.
2. **The approval path is sacred.** If a day slips, cut from Epic 4 (PWA polish) or Epic 5 R5.2 (voice), never from Epic 2.
3. **Documentation is written as you go**, not on day 7. Every merged phase updates the README section it affects.
4. **Never fake data.** If a value is unavailable, render `—`. See `context.md` §6.
5. **Commit `.kiro/` from the first commit.** Verify with `git check-ignore -v .kiro` — it must print nothing.
6. **When blocked > 45 minutes on an unverified ACP assumption, stop and re-read `docs/acp-findings.md`.** Guessing at protocol shapes is the single biggest source of wasted time in this project.

---

## 3. Split for a team of two

| Role | Owns |
|---|---|
| **A — Bridge & protocol** (Jithindranaath) | Epics 1, 2, 3, plus the mock agent so B is never blocked on a real agent. The critical path. |
| **B — Clients & verification** (Sri Dakshith Nimmagadda) | Epics 4, 5. Works against the mock agent from Phase 1, so it does not wait for Phase 2 to land the protocol. Owns on-device testing. |

Epic 6 (quality and docs) is shared and starts day 1, not day 7 — with two people there is no third person to absorb it late.

With only two, cut R5.2 (voice) and R2.3 (audit API) early if the schedule tightens, and follow the same order.

---

## 4. Phases

### PHASE 0 — Verification spike · Sun 16 Aug
*Nothing else matters until this is done. No implementation code today.*

- [ ] Install Kiro CLI. Record version in `docs/acp-findings.md`. `[A8]`
- [ ] Run a real Kiro session in the terminal, trigger a shell command, observe the approval prompt manually. Understand the UX you are replacing.
- [ ] Verify **A1**: exact command that launches the ACP agent. `kiro-cli --help` + https://kiro.dev/docs/cli/acp/
- [ ] Verify **A2/A3**: hand-write an `initialize` JSON-RPC frame to the agent's stdin. Capture the response verbatim.
- [ ] Verify **A6**: record advertised capabilities.
- [ ] Verify **A4**: `session/new`, send a prompt, log **every** inbound frame to a file. Paste representative frames into `docs/acp-findings.md`.
- [ ] Verify **A5**: force a shell-command approval. **Capture the exact permission request frame and the exact expected response shape.** This is the most important artifact of the entire day.
- [ ] Verify **A10**: find the cancellation mechanism.
- [ ] Verify **A9**: search all captured frames for token/usage fields. Record present or absent. If absent, delete usage display from the plan — do not fake it.
- [ ] Verify **A7/A8**: note `_kiro.dev/` extensions; write a trivial `postToolUse` hook that appends to a log; confirm it fires.
- [ ] Scaffold repo: pnpm workspace, 4 packages, TS strict, vitest, `.kiro/` committed, CI skeleton. `[R6.1.5]`

**🚨 GATE 0 — end of Mon 17 Aug (hard kill criterion)**

You must be able to demonstrate, from a script: spawn agent → initialize → create session → send prompt → receive streamed output → receive a permission request → answer it → agent continues.

**If this does not work by 23:59 on 17 August, stop and pivot the project.** Without ACP-hosted permission interception there is no differentiator versus Kiro for iOS, and the submission is not competitive. Deciding this on day 2 costs you two days; discovering it on day 6 costs you the hackathon.

---

### PHASE 1 — Protocol + mock agent · Mon 17 Aug
*Unblocks the client devs. Do this before the Bridge internals.*

- [ ] `packages/protocol`: all AWP frames as zod schemas + inferred TS types, exactly per `architecture.md` §5. `[R1.3, R2.1, R3.2]`
- [ ] Error codes and exit codes as const enums. `[§5.4]`
- [ ] `packages/mock-agent`: ACP subset over stdio, scenario-driven. `[AC6.1.1]`
- [ ] Scenarios: `happy-path`, `permission-escalation`, `agent-crash`, `slow-agent`.
- [ ] Publish `docs/protocol.md` from the schemas. **Client devs code against this from now on.**

**GATE 1:** `packages/protocol` builds; mock agent replays every scenario deterministically; `docs/protocol.md` published.

---

### PHASE 2 — Bridge core · Tue 18 Aug

- [ ] `acp/client.ts`: JSON-RPC 2.0 framing, request/response correlation, notification dispatch. `[R1.1]`
- [ ] `acp/methods.ts`: typed wrappers using **verified** names only. `[R1.1, R1.2]`
- [ ] `acp/normalize.ts`: ACP → AWP events, including the mandatory `unknown` fallback. `[AC1.3.5]`
- [ ] `session/manager.ts`: registry, create/list, status derivation with `statusSource`. `[R1.2, R1.4]`
- [ ] `session/ringbuffer.ts`: 500 events, monotonic `seq`, replay-since. `[AC1.3.2–4]`
- [ ] Spawn failure, crash, and respawn-backoff handling. `[AC1.1.3, AC1.1.4]`
- [ ] `--trace` frame logging. `[AC1.1.5]`
- [ ] `server/auth.ts`: pairing code, QR, tokens, constant-time compare, rate limit. `[R3.2]`
- [ ] `server/http.ts`: `/api/pair`, `/api/health`, static PWA serving. `[R3.1]`
- [ ] `server/ws.ts`: auth gate, subscribe + replay, fan-out, heartbeat. `[R3.1, R3.3]`
- [ ] `prompt.send` and `session.interrupt`. `[R1.5]`
- [ ] Unit tests: normalisation, ring buffer replay (no gaps, no dupes), auth. `[AC6.1.2]`
- [ ] Write `docs/status-inference.md`. `[AC1.4.4]`

**GATE 2:** `wscat` can pair, authenticate, subscribe, create a session against the **real** Kiro agent, and stream live events. Replay-since verified with no gaps or duplicates.

---

### PHASE 3 — Permission engine · Wed 19 Aug
*The differentiator. Do not compress this phase.*

- [ ] `approval/manager.ts`: hold ACP request, `PendingApproval` record, idempotent resolution, timeout→deny. `[R2.1]`
- [ ] `summary` generation per `architecture.md` §5.5. `[AC2.1.2]`
- [ ] `policy/engine.ts`: all-match evaluation, deny > escalate > allow, unmatched → escalate. `[R2.2]`
- [ ] `policy/defaults.json`: read-only allow, in-cwd write allow, dangerous-command list, secret-path list, self-modification deny. `[AC2.2.4]`
- [ ] `--paranoid` flag; malformed-policy fallback. `[AC2.2.5, AC2.2.7]`
- [ ] `permission.resolved` emitted for policy auto-resolutions too. `[AC2.2.6]`
- [ ] Audit log `~/.aibou/audit.jsonl` + `GET /api/audit`. `[R2.3 — P1, cut if behind]`
- [ ] Policy test table: ≥ 20 positive, ≥ 10 negative cases. `[AC2.2.8]`
- [ ] Invariant tests for all six rules in `architecture.md` §6.
- [ ] Integration test: create → prompt → permission → approve → resolved. `[AC6.1.3]`

**GATE 3 — the money shot must work.** Run a real Kiro session, ask it to run a shell command, approve it from `wscat`, watch the agent continue. **Record this on video today as insurance**, even if it is ugly footage.

---

### PHASE 4 — PWA · Thu 20 Aug
*Dev B has been building against the mock agent since Phase 1; today it meets the real Bridge.*

- [ ] Pairing: 6-digit entry + QR scan, token in `localStorage`. `[AC4.1.1]`
- [ ] WS hook: connect, auth, subscribe, backoff reconnect, resubscribe with last `seq`. `[AC3.3.2, AC4.1.6]`
- [ ] Session list with status + pending badge. `[AC4.1.2]`
- [ ] Event stream view, auto-scroll only when already at bottom. `[AC4.1.3]`
- [ ] Approval card: full `toolInput`, shell/diff highlighting, Approve/Deny. `[AC4.1.4]`
- [ ] Prompt input + interrupt control (hidden when `AIBOU_UNSUPPORTED`). `[AC4.1.5, AC1.5.3]`
- [ ] `inferred` badge rendering on inferred statuses. `[AC1.4.3]`
- [ ] Mock-mode amber banner. `[AC4.1.7]`
- [ ] Manifest + service worker; passes Chrome installability check. `[AC4.2.1]`
- [ ] `Notification` on escalation when permitted. `[AC4.2.2]`

**GATE 4:** full approval loop driven from a phone browser on the LAN.

---

### PHASE 5 — Wear OS · Fri 21 Aug
*Scope is deliberately tiny. Resist adding screens.*

- [ ] Gradle project, Compose for Wear OS, minSdk 30. Confirm it builds and runs in the Wear emulator **before** writing features.
- [ ] Kotlin mirror of AWP data classes. `[architecture §2]`
- [ ] `AibouClient`: OkHttp WebSocket, auth, subscribe, backoff reconnect, `StateFlow<UiState>`. `[AC5.1.2, AC5.1.7]`
- [ ] `PairScreen`: 6-digit keypad, `EncryptedSharedPreferences`. `[AC5.1.1]`
- [ ] `StatusScreen`: session, status, elapsed, mock badge. `[AC5.1.3]`
- [ ] `ApprovalScreen`: vibrate + wake, ≥48 dp Approve/Deny, dismiss on external resolution. `[AC5.1.4, AC5.1.5]`
- [ ] Interrupt with confirm swipe. `[AC5.1.6]`
- [ ] `VoiceScreen`: `RecognizerIntent`, transcript confirmation, hidden if unavailable. `[R5.2 — P1]`
- [ ] Debug network-security-config for `10.0.2.2` + RFC1918. `[architecture §10]`
- [ ] Signed release APK; attach to a GitHub release. `[AC6.2.3]`

**GATE 5:** on a physical Galaxy Watch (or the emulator), a real Kiro session stalls, the watch buzzes, one tap, the agent continues. **This is the demo. Film it properly today.**

---

### PHASE 6 — Harden, document, verify · Sat 22 Aug
*No new features. None.*

- [ ] Walk the failure matrix (`architecture.md` §11) manually. Fix anything that crashes.
- [ ] Coverage ≥ 70% on `packages/bridge/src`. `[AC6.1.2]`
- [ ] `make demo` from a clean clone, no Kiro credentials. `[AC6.2.2]`
- [ ] **`README.md`** — pitch; *How this differs from Kiro for iOS* in the first screen; ≤5-min quickstart; architecture diagram; feature table marking observed vs inferred; mock-mode explanation; Kiro usage section with the reflexive angle; honest limitations. `[R6.3, R6.4]`
- [ ] `SECURITY.md`, `CONTRIBUTING.md`, `docs/` complete. `[R6.3]`
- [ ] `.kiro/specs`, `.kiro/steering`, `.kiro/hooks` committed and real. `[R6.4]`
- [ ] **Clean-machine test: someone who did not write the code follows the README on a fresh machine, timed.** Every stumble is a README bug. Fix and re-run. `[AC6.2.4]`
- [ ] Emulator `10.0.2.2` note present in the quickstart. This is the #1 predicted judge failure.
- [ ] Tag `v1.0.0`, publish release with the Wear APK.

**GATE 6:** an outsider goes clone → working UI in under 5 minutes and 4 commands.

---

### PHASE 7 — Video and submit · Sun 23 Aug
*Deadline is 23:59 **UTC**. Submit by 18:00 UTC. Do not test this boundary.*

- [ ] Record per the beat sheet in `specs.md` §R6.5.
- [ ] The watch-approval beat is **one unbroken take**. A cut there reads as staged and invites doubt about whether it works.
- [ ] Say the Kiro-for-iOS distinction out loud in the first 30 seconds.
- [ ] Show `.kiro/` on screen.
- [ ] State limitations honestly at the end. Judges reward this; it costs nothing.
- [ ] Upload to YouTube (unlisted is fine), confirm the link works signed out.
- [ ] Confirm the repo is public and the video link works **from a private browser window**.
- [ ] Submit the Google Form. Screenshot the confirmation.

---

## 5. Cut list — in order

When behind, cut from the top:

1. R2.3 audit API (keep the file, drop the endpoint)
2. R5.2 voice on Wear
3. R4.2.2 browser notifications
4. Multi-session support → single session only
5. QR pairing → 6-digit code only
6. Policy editing UI → hand-edited `policy.json` only

**Never cut:** Epic 2 (permissions), R6.2 (judge-runnable), R6.3 (documentation), R6.4 (`.kiro` evidence).

---

## 6. Kill criterion

**Gate 0, end of 17 August.** If ACP-hosted permission interception is not demonstrably working end-to-end, Aibou has no differentiator against Kiro for iOS and should not be submitted in this form.

Fallback if the gate fails: pivot to a **hooks-only local observability + notification tool** — no approvals, no ACP — repositioned honestly as "know instantly when your local agent stalls," with the policy engine reframed as a *warning* engine over `preToolUse` hook events. Weaker, but shippable in the remaining five days, and honest about what it does.

Decide on 17 August. Do not defer the decision.

---

## 7. Definition of done

- [ ] `make check` green from a clean clone
- [ ] `make demo` works with zero Kiro credentials
- [ ] Real Kiro session + watch approval works on real hardware
- [ ] Outsider completed setup in < 5 min, timed
- [ ] Every number on screen traceable to a real event; every inference labelled
- [ ] `.kiro/` committed, non-empty, and genuinely used
- [ ] README opens with the Kiro-for-iOS distinction
- [ ] `SECURITY.md` exists and is accurate
- [ ] Video uploaded, verified signed-out, ≤ 3 min
- [ ] Form submitted before 18:00 UTC on 23 August