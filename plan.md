# Aibou — Implementation Plan

## Phase 1: Foundation (Weeks 1-4)

### Goal
Get a working end-to-end prototype: daemon intercepts a gate → sends to phone → user taps approve → agent resumes.

### Tasks

#### Week 1-2: Local Daemon
- [ ] Set up Rust/Go project for the daemon process
- [ ] Implement file watcher to detect agent approval prompts (start with one agent)
- [ ] Build WebSocket client for relay communication
- [ ] Create local config file format for policy rules
- [ ] Implement basic policy engine (allow/deny/escalate)

#### Week 3: Relay Service
- [ ] Set up cloud relay service (WebSocket server)
- [ ] Implement device registration and authentication
- [ ] Build message routing (daemon ↔ mobile device)
- [ ] Add push notification integration (APNs + FCM)
- [ ] Implement E2E encryption for approval payloads

#### Week 4: Mobile App (MVP)
- [ ] iOS app with push notification handling
- [ ] Approve/deny action buttons on notification
- [ ] Basic session view (what's the agent doing?)
- [ ] Device pairing flow (QR code from daemon)

### Deliverable
Demo: Start an agent task, walk away, approve from phone, agent continues.

---

## Phase 2: Watch & Polish (Weeks 5-8)

### Goal
Watch app working, policy engine learning, support for 2-3 agents.

### Tasks

#### Week 5-6: Watch Apps
- [ ] watchOS app with complication
- [ ] Actionable notifications on Apple Watch
- [ ] Context-compressed action summaries (< 50 chars)
- [ ] "View on phone" handoff for complex actions
- [ ] Wear OS app (stretch goal)

#### Week 7: Smart Policies
- [ ] Track approve/deny history per action type
- [ ] Implement pattern detection (same command approved 5x → suggest auto-approve)
- [ ] Rule suggestion UI in mobile app
- [ ] Per-project rule scoping
- [ ] Import/export rule sets

#### Week 8: Multi-Agent Support
- [ ] Abstract agent integration interface
- [ ] Add VS Code extension integration (Kiro, Copilot)
- [ ] Add CLI agent integration (Claude Code, Aider)
- [ ] Add MCP-based integration
- [ ] Agent detection and auto-configuration

### Deliverable
Watch demo with learned auto-approve rules across multiple agents.

---

## Phase 3: Production Hardening (Weeks 9-12)

### Goal
Security audit, performance optimization, beta release.

### Tasks

#### Week 9-10: Security
- [ ] Threat model and security audit
- [ ] Device attestation (prevent relay spoofing)
- [ ] Biometric requirement for dangerous actions
- [ ] Session token rotation
- [ ] Rate limiting and abuse prevention
- [ ] Audit log with tamper detection

#### Week 11: Performance & Reliability
- [ ] Notification latency optimization (target < 2s p95)
- [ ] Offline queuing and reconnection logic
- [ ] Battery optimization for watch apps
- [ ] Load testing relay service
- [ ] Graceful degradation (relay down → fall back to desktop)

#### Week 12: Beta Release
- [ ] TestFlight / Play Store internal testing
- [ ] Documentation and onboarding flow
- [ ] Telemetry and crash reporting
- [ ] Feedback collection mechanism
- [ ] Landing page and waitlist

### Deliverable
Closed beta with 20-50 users, all core features working.

---

## Phase 4: Launch (Weeks 13-16)

### Tasks
- [ ] Public App Store / Play Store submission
- [ ] Open source the daemon and integration SDKs
- [ ] Pricing model (free tier + pro)
- [ ] Team features (shared policies, audit trails)
- [ ] Marketing launch (dev Twitter, Hacker News, Product Hunt)

---

## Tech Stack (Proposed)

| Component | Technology | Rationale |
|---|---|---|
| Daemon | Rust | Low resource usage, cross-platform, fast startup |
| Relay Service | Go + WebSockets | Simple concurrency model, low latency |
| Mobile Apps | Swift (iOS) / Kotlin (Android) | Native performance, watch SDK access |
| Watch Apps | SwiftUI (watchOS) / Compose (Wear OS) | Modern declarative UI |
| Push Notifications | APNs + FCM | Platform standard |
| Encryption | libsignal / Noise Protocol | Proven E2E encryption |
| Policy Engine | Custom DSL → Rust | Fast evaluation, expressive rules |
| Database (relay) | PostgreSQL + Redis | Persistent state + pub/sub |
| Infrastructure | Fly.io or AWS | Low-latency global deployment |

---

## Milestones & Decision Points

| Week | Milestone | Go/No-Go Decision |
|---|---|---|
| 4 | End-to-end phone approval working | Is latency acceptable? |
| 6 | Watch notifications functional | Is the UX usable at glance? |
| 8 | Multi-agent support | Which agents have the most users? |
| 10 | Security audit complete | Any blockers for public release? |
| 12 | Beta launch | Is retention/engagement sufficient? |
| 16 | Public launch | Revenue model validated? |

---

## Open Questions

1. Should the daemon be a standalone process or embedded in a VS Code extension?
2. Do we build our own relay or use an existing service (Pusher, Ably)?
3. What's the right default policy — too permissive risks trust, too strict risks fatigue?
4. How do we handle agents that don't have clean approval APIs (screen scraping)?
5. Is there a market for a "team" version with shared policies and audit trails?
