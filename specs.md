# Aibou — Product Specification

## Overview

Aibou is a bridge between AI coding agents and the developer's mobile devices (phone and smartwatch). It eliminates idle wait time caused by permission prompts by delivering approval requests to the developer wherever they are, and learning which actions can be auto-approved over time.

## Problem Statement

AI coding agents (Kiro, Cursor, Copilot, Claude Code, etc.) frequently pause execution to request human approval for potentially risky actions — running shell commands, deleting files, modifying configurations. If the developer is away from their desk, the agent sits idle until they return. This defeats the purpose of autonomous coding assistance.

## Solution

Aibou intercepts approval requests from the coding agent, evaluates them against a configurable policy engine, and either:

1. **Auto-approves** low-risk actions silently (based on learned rules)
2. **Escalates** high-risk actions to the developer's phone/watch via push notification
3. **Auto-denies** actions that violate hard rules (e.g., touching files outside project scope)

## Core Features

### F1: Real-Time Approval Notifications

- Push notifications to phone and smartwatch when agent needs permission
- Display a concise summary of the requested action
- One-tap approve/deny interface
- "View details" option for complex actions (opens full context on phone)

### F2: Policy Engine

- Rule-based system for categorizing actions by risk level
- Default rules out of the box (read = safe, delete outside project = dangerous)
- User-configurable rules with simple syntax
- Rules can target: command patterns, file paths, action types, directories

### F3: Adaptive Learning

- Track approve/deny decisions over time
- Suggest new auto-approve rules based on patterns
- Never auto-promote to auto-approve without explicit user consent
- Per-project and global rule scopes

### F4: Agent Integration Layer

- Protocol-agnostic proxy that intercepts approval gates
- Support for multiple agent backends (VS Code extensions, CLI agents, MCP servers)
- Lightweight daemon running on the developer's machine
- WebSocket connection to relay service

### F5: Multi-Device Support

- Native watchOS app (Apple Watch)
- Wear OS app (Android watches)
- iOS companion app
- Android companion app
- Web dashboard fallback

### F6: Session Awareness

- Show active agent sessions and their status
- Timeline of approved/denied actions
- Ability to pause/resume agent remotely
- Kill switch to halt all agent activity immediately

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| Notification latency | < 3 seconds end-to-end |
| Availability | 99.9% uptime for relay service |
| Security | End-to-end encryption for all approval payloads |
| Battery impact (watch) | < 5% per day under normal use |
| Offline behavior | Queue notifications, deliver on reconnect |

## User Stories

1. As a developer, I want to receive a watch notification when my agent needs approval so I don't have to stay at my desk.
2. As a developer, I want to approve safe actions with a single tap so the agent can continue quickly.
3. As a developer, I want to define rules for what gets auto-approved so I'm not bothered by routine actions.
4. As a developer, I want dangerous actions (file deletion, system commands) to always require my explicit approval.
5. As a developer, I want to see a history of what my agent did while I was away.
6. As a developer, I want a kill switch to stop the agent immediately from my phone or watch.

## Success Metrics

- Reduce average agent idle time by 80%
- < 3 second median response time from notification to agent resumption
- < 5 false escalations per day after 1 week of usage
- User retention: 70% weekly active after first month

## Out of Scope (v1)

- Multi-user / team approval workflows
- Voice-based approval (Siri/Google Assistant)
- Agent-to-agent delegation
- Custom agent development framework
