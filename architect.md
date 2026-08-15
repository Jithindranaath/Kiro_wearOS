# Aibou — Architecture Document

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Developer's Machine                          │
│                                                                 │
│  ┌──────────┐     ┌──────────────┐     ┌───────────────────┐   │
│  │ AI Agent │────▶│ Aibou Daemon │────▶│ Policy Engine     │   │
│  │(Kiro,etc)│◀────│              │     │                   │   │
│  └──────────┘     └──────┬───────┘     │ • Rule matching   │   │
│                          │             │ • Learning model  │   │
│                          │             │ • Action history  │   │
│                          │             └───────────────────┘   │
└──────────────────────────┼──────────────────────────────────────┘
                           │ WebSocket (E2E encrypted)
                           ▼
              ┌────────────────────────┐
              │     Relay Service      │
              │                        │
              │ • Device registry      │
              │ • Message routing      │
              │ • Push dispatch        │
              │ • Session management   │
              └───────────┬────────────┘
                          │ Push Notifications
                ┌─────────┴─────────┐
                ▼                   ▼
        ┌──────────────┐   ┌──────────────┐
        │  Phone App   │   │  Watch App   │
        │              │   │              │
        │ • Full view  │   │ • Glance     │
        │ • Rules UI   │   │ • Tap to act │
        │ • History    │   │ • Haptics    │
        └──────────────┘   └──────────────┘
```

## Component Architecture

### 1. Aibou Daemon

The daemon is the core local component. It runs as a background process on the developer's machine.

**Responsibilities:**
- Intercept approval gates from AI agents
- Evaluate actions against the policy engine
- Communicate with the relay service
- Cache decisions locally for offline resilience
- Provide a local HTTP API for extensions/integrations

**Architecture:**

```
┌─────────────────────────────────────────────┐
│                Aibou Daemon                  │
│                                             │
│  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Agent Adapters   │  │ Policy Engine   │  │
│  │                  │  │                 │  │
│  │ • VSCode IPC     │  │ • Rule store    │  │
│  │ • CLI stdout     │  │ • Evaluator     │  │
│  │ • MCP protocol   │  │ • Learner       │  │
│  │ • File watcher   │  │ • Suggestions   │  │
│  └────────┬─────────┘  └────────┬────────┘  │
│           │                      │           │
│  ┌────────▼──────────────────────▼────────┐  │
│  │           Core Orchestrator            │  │
│  │                                        │  │
│  │  • Gate detection                      │  │
│  │  • Decision routing                    │  │
│  │  • Response delivery                   │  │
│  │  • Timeout handling                    │  │
│  └────────────────────┬───────────────────┘  │
│                       │                      │
│  ┌────────────────────▼───────────────────┐  │
│  │         Transport Layer                │  │
│  │                                        │  │
│  │  • WebSocket client                    │  │
│  │  • E2E encryption                     │  │
│  │  • Reconnection logic                 │  │
│  │  • Local HTTP API (port 7749)         │  │
│  └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**Agent Adapter Interface:**

```rust
trait AgentAdapter {
    /// Start listening for approval gates from this agent
    fn start(&mut self, sender: Sender<Gate>) -> Result<()>;
    
    /// Deliver an approval/denial decision back to the agent
    fn respond(&self, gate_id: &str, decision: Decision) -> Result<()>;
    
    /// Check if this adapter can handle the given agent
    fn can_handle(&self, agent_info: &AgentInfo) -> bool;
}

struct Gate {
    id: String,
    agent: String,
    action: Action,
    context: ActionContext,
    timestamp: Instant,
}

enum Action {
    RunCommand { command: String, cwd: PathBuf },
    WriteFile { path: PathBuf, summary: String },
    DeleteFile { path: PathBuf },
    ReadFile { path: PathBuf },
    NetworkRequest { url: String, method: String },
    Custom { kind: String, description: String },
}

enum Decision {
    Approve,
    Deny,
    ApproveAlways,  // Auto-approve this pattern going forward
    Timeout,        // No response within configured window
}
```

### 2. Policy Engine

The policy engine determines whether an action should be auto-approved, auto-denied, or escalated to the user.

**Rule Evaluation Order:**
1. Hard denies (blocklist) — always deny, never learn away
2. Hard approves (allowlist) — always approve silently
3. Learned rules — patterns from user behavior
4. Default policy — escalate to user

**Rule Format:**

```yaml
# ~/.aibou/policies/default.yaml
version: 1
project: "*"

rules:
  # Always allow reading any file in the project
  - action: read_file
    path: "${PROJECT}/**"
    decision: approve

  # Always allow running test commands
  - action: run_command
    pattern: "npm test*|cargo test*|pytest*"
    decision: approve

  # Never allow touching SSH keys
  - action: "*"
    path: "~/.ssh/**"
    decision: deny

  # Never allow rm -rf outside project
  - action: run_command
    pattern: "rm -rf*"
    path_not: "${PROJECT}/**"
    decision: deny

  # Everything else: ask me
  - action: "*"
    decision: escalate
```

**Learning Model:**

```
┌──────────────────────────────────────────┐
│           Adaptive Learning              │
│                                          │
│  Input: (action_type, path_pattern,      │
│          command_pattern, user_decision)  │
│                                          │
│  Logic:                                  │
│  1. Group by (action_type + pattern)     │
│  2. If approved >= N times consecutively │
│     → suggest auto-approve rule          │
│  3. If denied >= N times consecutively   │
│     → suggest auto-deny rule             │
│  4. Never auto-promote without consent   │
│                                          │
│  Output: Rule suggestions shown in app   │
└──────────────────────────────────────────┘
```

### 3. Relay Service

The relay service is a lightweight cloud component that routes messages between daemons and mobile devices.

**Design Principles:**
- Stateless message routing (no persistent storage of approval content)
- E2E encrypted payloads (relay cannot read action details)
- Metadata-only storage (timestamps, device IDs, delivery status)
- Horizontally scalable

**Architecture:**

```
┌───────────────────────────────────────────────┐
│              Relay Service                     │
│                                               │
│  ┌─────────────┐  ┌────────────────────────┐  │
│  │ WebSocket   │  │ Push Notification      │  │
│  │ Gateway     │  │ Dispatcher             │  │
│  │             │  │                        │  │
│  │ • Auth      │  │ • APNs (iOS/Watch)     │  │
│  │ • Routing   │  │ • FCM (Android/Wear)   │  │
│  │ • Heartbeat │  │ • Fallback (WebPush)   │  │
│  └──────┬──────┘  └───────────┬────────────┘  │
│         │                     │               │
│  ┌──────▼─────────────────────▼────────────┐  │
│  │         Session Manager                 │  │
│  │                                         │  │
│  │  • Device registry                      │  │
│  │  • Daemon <-> Device mapping            │  │
│  │  • Pending gate queue                   │  │
│  │  • Delivery confirmation                │  │
│  └─────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
```

**API Endpoints:**

| Endpoint | Method | Description |
|---|---|---|
| `/ws/daemon` | WS | Daemon connection (sends gates, receives decisions) |
| `/ws/device` | WS | Mobile app connection (receives gates, sends decisions) |
| `/api/register` | POST | Register a new device |
| `/api/pair` | POST | Pair a device with a daemon |
| `/api/sessions` | GET | List active agent sessions |
| `/api/history` | GET | Recent approval history |

### 4. Mobile & Watch Apps

**Phone App Layers:**

```
┌─────────────────────────────────┐
│         Presentation            │
│  • Notification UI              │
│  • Session dashboard            │
│  • Rule management              │
│  • Pairing flow                 │
├─────────────────────────────────┤
│         Domain Logic            │
│  • Decision handling            │
│  • Rule CRUD                    │
│  • Session state                │
├─────────────────────────────────┤
│         Data / Network          │
│  • WebSocket client             │
│  • Push notification handler    │
│  • Local storage (rules cache)  │
│  • E2E crypto                   │
└─────────────────────────────────┘
```

**Watch App Constraints:**
- Max 2 lines of text for action summary
- Binary action: Approve (green) / Deny (red)
- Haptic pattern distinguishes risk level (gentle = routine, strong = dangerous)
- "Open on Phone" for anything that needs more context
- Complication shows: pending gate count

### 5. Security Architecture

**Threat Model:**

| Threat | Mitigation |
|---|---|
| Man-in-the-middle on relay | E2E encryption (Noise Protocol XX handshake) |
| Stolen phone approves malicious action | Biometric required for high-risk actions |
| Compromised relay service | Zero-knowledge design, encrypted payloads |
| Replay attacks | Nonce + timestamp on every gate message |
| Rogue daemon impersonation | Device-to-daemon pairing with shared secret |

**Encryption Flow:**

```
Daemon                          Relay                     Phone
  |                               |                        |
  |---- Encrypted Gate ---------->|---- Push + Payload --->|
  |     (only phone can decrypt)  |    (relay can't read)  |
  |                               |                        |
  |<--- Encrypted Decision ------|<--- Decision ----------|
  |     (only daemon can decrypt) |    (relay can't read)  |
```

**Key Exchange:**
- Pairing establishes a shared symmetric key via QR code (out-of-band)
- Session keys derived per connection using HKDF
- Key rotation every 24 hours or 1000 messages (whichever first)

### 6. Data Flow — Happy Path

```
1. Agent hits a permission gate (e.g., wants to run `npm run build`)
2. Agent adapter detects the gate, creates a Gate struct
3. Policy engine evaluates:
   - Is `npm run build` in the allowlist? -> Auto-approve, skip to step 8
   - Is it in the blocklist? -> Auto-deny, skip to step 8
   - Neither -> Escalate
4. Daemon encrypts gate summary, sends to relay via WebSocket
5. Relay dispatches push notification to registered devices
6. Watch buzzes, shows: "Run: npm run build" with checkmark/X buttons
7. User taps checkmark (approve)
8. Decision flows back: Phone -> Relay -> Daemon -> Agent adapter
9. Agent resumes execution
```

**Timeout Handling:**
- Default timeout: 5 minutes (configurable)
- On timeout: apply default policy (deny for high-risk, approve for low-risk)
- Notify user that timeout occurred

### 7. Scalability Considerations

| Dimension | Design Choice |
|---|---|
| Concurrent daemons | Relay uses connection-per-daemon, horizontally scaled |
| Message throughput | Most messages are tiny (< 1KB), WebSocket is efficient |
| Global latency | Deploy relay in multiple regions, route to nearest |
| Storage | Minimal — only metadata and device registry persisted |
| Watch battery | Batch non-urgent notifications, use silent push for low-risk |

### 8. Deployment Architecture

```
┌─────────────────────────────────────────────┐
│              Production                      │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ Relay   │  │ Relay   │  │ Relay   │    │
│  │ (US-E)  │  │ (EU-W)  │  │ (APAC)  │    │
│  └────┬────┘  └────┬────┘  └────┬────┘    │
│       │             │             │         │
│  ┌────▼─────────────▼─────────────▼────┐   │
│  │         Redis Pub/Sub               │   │
│  │    (cross-region message routing)   │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │         PostgreSQL                  │   │
│  │    (device registry, audit log)     │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 9. Integration Points

**VS Code Extension Integration:**
- Listen on VS Code's terminal output for approval prompts
- Hook into extension APIs where available (Kiro hooks, Copilot events)
- Inject responses back via simulated user input or API calls

**CLI Agent Integration:**
- Wrap agent CLI in a PTY proxy
- Parse stdout for approval patterns
- Inject stdin responses

**MCP Integration:**
- Implement as an MCP server that agents route approvals through
- Cleanest integration path for MCP-aware agents
- Standard tool interface: `request_approval(action, context) -> decision`

### 10. Future Architecture Extensions

- **Team relay:** Shared policies, delegated approvals, escalation chains
- **Agent marketplace:** Community-contributed adapter plugins
- **Analytics dashboard:** Team-wide metrics on agent usage and approval patterns
- **Webhook integrations:** Slack/Teams notifications as fallback channel
- **Voice approval:** "Hey Siri, approve" via Shortcuts integration
