# Aibou — Project Context

## What Is This Project?

Aibou (Japanese for "partner") is a developer tool that connects AI coding agents to your phone and smartwatch. When an agent pauses for permission, Aibou sends the approval request to your wrist. You tap approve or deny, and the agent continues — no need to return to your desk.

## Why Does This Exist?

AI coding agents are becoming powerful enough to run autonomously for extended periods. But they still require human-in-the-loop approval for risky operations: running commands, deleting files, modifying system configs. This creates a fundamental UX problem:

- The agent works for 2 minutes, then waits for 45 minutes because you stepped away.
- The total wall-clock time for a task balloons despite the AI being fast.
- Developers feel chained to their desk "babysitting" the agent.

Aibou breaks this dependency by making the approval loop mobile.

## Target Users

- **Primary:** Professional developers using AI coding agents (Kiro, Cursor, Copilot Workspace, Claude Code, Aider, etc.) who frequently step away from their workstation.
- **Secondary:** Teams running long autonomous agent sessions (overnight builds, large refactors) who need async oversight.

## Market Context

- AI coding agents are proliferating rapidly (2024-2026)
- Agents are getting longer-running and more autonomous
- No existing product solves the "away from desk" approval problem
- Closest analogs: CI/CD approval gates (but those are async and slow), mobile SSH apps (but those require manual intervention)

## Key Assumptions

1. Developers already use AI coding agents that have permission gates
2. Most developers carry a phone; many have a smartwatch
3. The majority of approval requests are routine and could be auto-approved
4. The remaining requests can be meaningfully summarized in < 50 characters for watch display
5. Push notification infrastructure is reliable enough for < 3 second delivery

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Security breach of approval channel | Critical — unauthorized code execution | E2E encryption, device attestation, biometric unlock |
| Notification fatigue | High — users disable notifications | Adaptive learning, aggressive auto-approve defaults |
| Agent protocol fragmentation | Medium — hard to support all agents | Abstract integration layer, start with 2-3 popular agents |
| Watch screen too small for context | Medium — bad approve/deny decisions | Smart summarization, "view on phone" escalation |
| Network latency spikes | Medium — agent still waits | Optimistic local timeout, fallback to auto-approve for safe actions |

## Competitive Landscape

| Product | What It Does | Gap Aibou Fills |
|---|---|---|
| Agent native UIs | Desktop-only approval prompts | No mobile/watch support |
| Pushover / Ntfy | Generic push notifications | No approve/deny flow, no policy engine |
| Mobile SSH (Termius) | Full terminal on phone | Requires manual intervention, no AI awareness |
| CI/CD approvals (GitHub Actions) | Async approval gates | Too slow, no watch UX, not for local agents |

## Terminology

- **Agent**: An AI coding assistant running on the developer's machine (e.g., Kiro, Claude Code)
- **Gate**: A point where the agent pauses and requests human approval
- **Policy**: A set of rules defining what gets auto-approved vs. escalated
- **Escalation**: Sending an approval request to the developer's device
- **Relay**: The cloud service that routes messages between daemon and mobile apps
- **Daemon**: The local process running on the developer's machine that intercepts gates

## Project Principles

1. **Speed over completeness** — A fast approve/deny is worth more than a detailed one
2. **Safe defaults** — Auto-approve reads, escalate writes, block anything outside project
3. **Trust is earned** — The system learns your preferences, never assumes them
4. **Security is non-negotiable** — The approval channel is as sensitive as SSH keys
5. **Agent-agnostic** — Support any agent that has a permission model, not just one
