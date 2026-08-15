# context.md — Aibou

> **Read this file first, in full, before writing any code or any other document.**
> Every decision in `specs.md`, `architecture.md`, and `plan.md` derives from this file.
> If any instruction elsewhere contradicts this file, this file wins — stop and flag the conflict.

---

## 1. What we are building

**Aibou** is a control plane for **locally running Kiro agent sessions**.

It consists of:

1. **The Bridge** — a Node.js daemon on the developer's machine that hosts a Kiro CLI session over the **Agent Client Protocol (ACP)**, observes it, and exposes a documented, authenticated WebSocket + HTTP API.
2. **The PWA** — a browser client (installable to a phone home screen) that is the full-featured surface: sessions, live events, diffs, task list, prompting, approvals.
3. **The Wear OS app** — a glanceable wrist client scoped to exactly one job: *unblock a stalled agent in under three seconds.*

The Bridge is the product. The clients are surfaces onto it.

---

## 2. The problem, stated precisely

Agent runs are long and bursty. The agent works for several minutes, then **stops and waits** for the human to approve a shell command, answer a question, or supply context. If the human has walked away, that wait is unbounded. A forty-minute task becomes a two-hour task because thirty-five of those minutes were the agent sitting idle behind a `y/n` prompt.

**Aibou's core job is to collapse that dead time to seconds.**

Everything else — the stats, the task list, the context meter — is supporting context around that one job. Do not let secondary features consume time budgeted for the approval path.

---

## 3. Prior art — READ CAREFULLY, THIS DEFINES OUR SCOPE

**Kiro for iOS exists.** AWS launched it on 17 June 2026 at the AWS New York Summit. It lets developers start, monitor, steer, and approve agentic coding sessions from a phone, review diffs, and manage multiple sessions.

**It connects only to cloud-based Kiro sessions running in AWS cloud sandboxes.** It does not, and cannot, reach a Kiro session running on the developer's own machine.

There is an open issue in the Kiro repository (#9460) requesting exactly what we are building: remote access to a *running local* Kiro agent session, with a session picker, an approval view for pending actions, and a way to type a reply. The requester explicitly notes that Kiro Web does not solve this, because it is a separate cloud agent tied to GitHub/GitLab repos and PRs — not their local session, local files, or local toolchain.

### The one-sentence differentiator

> Kiro for iOS supervises sessions running in AWS's cloud. Aibou supervises the session running on *your own machine* — the one with your local files, your local toolchain, and your uncommitted work.

**This distinction must appear in:**
- The README, in the first screen of content, in a section titled "How this differs from Kiro for iOS"
- The demo video, within the first 30 seconds
- The PWA's about/landing state

Never write copy that implies we invented mobile agent supervision. We did not. We extended it to the local session, which the official product does not cover.

---

## 4. Who is judging and what they score

This is the **Ready, Spec, Ship Hackathon**, sponsored by Kiro, hosted by John Crickett, Angie Jones, and Gregor Ojstersek.

| Criterion | Points | What it actually means for us |
|---|---:|---|
| Application Quality | 40 | It installs and runs on a clean machine, first try, matching the README. |
| Kiro Usage | 20 | The `.kiro/` directory is real, committed, and demonstrably drove the build. |
| Documentation | 20 | README, architecture, setup, testing instructions — cheap points, do not skimp. |
| Innovation and Potential | 15 | Local-session gap + permission policy engine. |
| Presentation | 5 | Demo video. |

**Hard requirements from the rules:**
- Submission deadline: **23 August 2026, 23:59 UTC.**
- The `.kiro` directory **must be committed to the public repo**.
- Judges must be able to run the project from a complete public repository with clear setup and testing instructions, **without making a payment**.
- **No simulated or hard-coded features presented as working functionality.** This is an explicit disqualifier. See §6.
- Team size: 1–3 people.

**Scoring insight that governs all prioritisation:** 60 of 100 points (Quality + Documentation) reward rigour and runnability. 15 reward novelty. When forced to choose between a new feature and making an existing feature reliably runnable by a judge, **always choose runnable.**

---

## 5. Non-goals — do not build these

Explicitly out of scope. If you find yourself building one of these, stop.

- A native iOS app. Undeliverable in the timeline; the PWA covers iOS.
- A native Android app. The PWA covers Android.
- A code editor, file browser, or full diff editor on the watch.
- Replacing or reimplementing Kiro Web / Kiro cloud sessions.
- Multi-user, multi-tenant, or hosted SaaS. Aibou is single-developer, local-first.
- Cloud relay / NAT traversal / public tunnelling. LAN or VPN only. Document Tailscale as a *user-supplied* option; do not implement it.
- Analytics, telemetry, or crash reporting.
- Credit / billing consumption tracking. See §6.
- Account systems, OAuth, user registration.
- Screen-scraping the Kiro TUI. If ACP does not expose something, we do not have it.

---

## 6. The honesty rule — non-negotiable

The competition rules prohibit *simulated or hard-coded features presented as working functionality*. Treat this as a correctness constraint, not a style guide.

**Rules the implementation must obey:**

1. **Never render a number the Bridge did not receive from a real ACP message or hook event.** If token usage is not available, the UI shows `—` and a tooltip explaining it is not exposed. It does not show a plausible-looking number.
2. **Credits / billing consumption are assumed NOT to be programmatically available.** Do not build a credits display. If, during the ACP spike, real credit data turns out to be exposed, it may be added — and only then.
3. **Where we infer state rather than observe it, the inference must be labelled in the UI and explained in the README.** Example: if we infer "awaiting approval" from a `preToolUse` event with no matching `postToolUse` within N seconds, the UI shows that state with an `inferred` marker and the README documents the heuristic and its failure modes.
4. **Mock mode is permitted and encouraged, but must be unmissable.** The Bridge ships a `--mock` flag backed by a fake ACP agent so that CI and judges without Kiro credits can exercise the full stack. When mock mode is active:
   - The Bridge logs a banner on startup.
   - Every WebSocket `hello` frame carries `mode: "mock"`.
   - The PWA renders a persistent amber bar reading `MOCK MODE — not a real Kiro session`.
   - The Wear app shows a mock badge on the status screen.
   - The README explains mock mode is a test harness, and that the default and demonstrated path is a real local Kiro session.

---

## 7. Security posture

We are building a remote control for a process that executes arbitrary shell commands. Treat security as an Application Quality deliverable, not a nice-to-have.

- Bridge binds to `127.0.0.1` by default. LAN binding (`0.0.0.0`) requires an explicit `--host` flag and prints a warning.
- No TLS termination by us; document that LAN use should be over a trusted network or VPN.
- Pairing: Bridge prints a 6-digit code + QR at startup. Clients exchange the code for a long-lived bearer token. Tokens are stored in `~/.aibou/config.json` with mode `0600`.
- Every WebSocket connection authenticates before receiving any session data. Unauthenticated sockets are closed after 5 seconds.
- The permission policy engine **fails closed**: an unmatched rule escalates to the human, never auto-approves.
- `deny` rules always take precedence over `allow` rules regardless of order.
- A `SECURITY.md` is a required deliverable, covering threat model, what an attacker on the LAN could do, and what we do about it.

---

## 8. Verify-before-building list

These are assumptions, not facts. **The first task in `plan.md` is to verify every one of them against the installed `kiro-cli` and the live docs at https://kiro.dev/docs/cli/acp/ before writing implementation code.** Record the verified answer in `docs/acp-findings.md`. Do not build on an unverified assumption.

| # | Assumption | How to verify |
|---|---|---|
| A1 | The ACP agent is launched via a `kiro-cli` subcommand (assumed `kiro-cli acp`). | `kiro-cli --help`, then the ACP docs page. |
| A2 | Transport is JSON-RPC 2.0 over stdin/stdout. | ACP docs; send an `initialize` frame by hand. |
| A3 | `initialize`, `session/new`, `session/load`, `session/prompt` exist with those exact names. | Handshake response `capabilities`; ACP spec. |
| A4 | The agent sends `session/update` notifications for streaming output, tool calls, and plan/task changes. | Run a real prompt, log every inbound frame verbatim. |
| A5 | Permission requests reach the client as an ACP request the client must answer (assumed `session/request_permission`). | Trigger a shell command in a real session; log the frame. |
| A6 | `loadSession: true` and `promptCapabilities.image: true` are advertised at init. | Read the `initialize` result. |
| A7 | Kiro-specific extensions are namespaced `_kiro.dev/...` and are safely ignorable. | Init result; ACP docs. |
| A8 | CLI hooks (`agentSpawn`, `userPromptSubmit`, `preToolUse`, `postToolUse`, `Stop`) deliver versioned JSON over STDIN and include `session_id` and `cwd`. | https://kiro.dev/docs/cli/hooks/ and a test hook that appends to a log. |
| A9 | Token/context usage is obtainable programmatically. | Inspect every ACP frame for usage fields. **If absent, feature is dropped, not faked.** |
| A10 | Cancellation / interrupt is expressible over ACP. | ACP spec; look for a cancel notification or session method. |

**If A1–A5 cannot be confirmed working end-to-end by end of day 17 August, invoke the kill criterion in `plan.md` §6.**

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **ACP** | Agent Client Protocol. JSON-RPC 2.0 over stdio, standardising agent↔editor communication. Kiro CLI implements it. |
| **Bridge** | The Aibou daemon. ACP *client* to Kiro; server to Aibou clients. |
| **AWP** | Aibou Wire Protocol. Our own JSON-over-WebSocket protocol between Bridge and clients. Defined in `architecture.md`. |
| **Escalation** | A permission request the policy engine could not auto-resolve, pushed to the human. |
| **Glanceable** | Readable and actionable in under 3 seconds without scrolling. The Wear design constraint. |
| **Local session** | A Kiro session running as a process on the developer's own machine. Our entire scope. |

---

## 10. Decision log

Append to this table when a non-obvious decision is made. Do not silently reverse a decision recorded here.

| # | Decision | Rationale |
|---|---|---|
| D1 | Bridge hosts Kiro as an ACP subprocess rather than attaching to a user-run TUI. | Only the ACP host owns the permission flow. Attaching gives observation without control. |
| D2 | TypeScript for Bridge, protocol, and PWA. | One language, one type definition shared across three of four packages. |
| D3 | PWA instead of native Android/iOS. | Covers both platforms, runs on a judge's phone from a URL, one codebase. |
| D4 | Wear OS app is standalone (direct WSS), not phone-companion. | Companion pairing is the classic Wear time sink and forces judges to run two emulators. |
| D5 | In-memory event ring buffer + JSON config; no database. | Fewer moving parts, fewer failure modes, nothing to migrate. |
| D6 | Permission policy engine included in v1. | It is the one capability Kiro for iOS does not have. It carries the Innovation score. |
| D7 | Credits tracking dropped. | Assumed unavailable; faking it violates the rules. |