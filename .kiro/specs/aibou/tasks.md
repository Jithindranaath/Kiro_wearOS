# Aibou — Tasks

## Phase 0: Verification & Scaffold ✅
- [x] Install and verify kiro-cli ACP command
- [x] Scaffold monorepo with pnpm workspaces
- [x] Create protocol package with AWP types
- [x] Verify ACP permission request flow (documented in docs/acp-findings.md)

## Phase 1: Bridge Core ✅
- [x] Implement ACP JSON-RPC client (client.ts)
- [x] Implement ACP method wrappers (methods.ts)
- [x] Implement ACP → AWP normalizer (normalize.ts)
- [x] Implement session manager with status derivation
- [x] Implement event ring buffer (500 events, replay-since)
- [x] Implement policy engine (deny > escalate > allow, fail-closed)
- [x] Implement default policy rules (20+ dangerous patterns)
- [x] Implement approval manager (hold, timeout, idempotent)
- [x] Implement HTTP server (pair, health, static PWA)
- [x] Implement WebSocket hub (auth, subscribe, fan-out, heartbeat)
- [x] Implement auth (6-digit code, CSPRNG tokens, constant-time compare, rate limit)
- [x] Unit tests: ring buffer (8 tests), policy engine (46 tests)

## Phase 2: PWA Client ✅
- [x] Pairing flow (6-digit code, token in localStorage)
- [x] WebSocket client with reconnect + replay
- [x] Session list with status + pending badge
- [x] Live event stream (auto-scroll only when at bottom)
- [x] Approval cards (full toolInput, shell highlighting, approve/deny)
- [x] Prompt input + interrupt button
- [x] Mock mode amber banner (persistent, unsuppressible)
- [x] Connection status indicator
- [x] Browser notifications on permission escalation
- [x] PWA manifest + service worker (installable)
- [x] Served from Bridge (single origin, no CORS)

## Phase 3: Wear OS ✅
- [x] Gradle project with Compose for Wear OS, minSdk 30
- [x] Kotlin AWP data class mirror
- [x] AibouClient: OkHttp WebSocket, auth, subscribe, backoff reconnect, StateFlow
- [x] TokenStore: EncryptedSharedPreferences
- [x] PairScreen: 6-digit keypad
- [x] StatusScreen: session, status, elapsed, mock badge, inferred marker
- [x] ApprovalScreen: vibrate + wake, ≥48dp Approve/Deny, dismiss on external resolution
- [x] VoiceScreen: RecognizerIntent, transcript confirmation, hidden if unavailable
- [x] Network security config for 10.0.2.2 + RFC1918
- [x] SwipeDismissable navigation (pair → status → approval)

## Phase 4: Polish & Documentation ✅
- [x] SECURITY.md (threat model, LAN exposure, token handling)
- [x] CONTRIBUTING.md (dev setup, test commands)
- [x] docs/architecture.md (system diagram, module map)
- [x] README.md (differentiator, quickstart, features, limitations, Kiro usage)
- [x] `pnpm run demo` works from clean clone (builds protocol + pwa + starts bridge)
- [x] Integration test: 36/36 passing
- [x] .kiro/ committed, non-empty, genuinely used
- [x] All packages typecheck clean
