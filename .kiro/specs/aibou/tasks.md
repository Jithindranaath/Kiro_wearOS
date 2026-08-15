# Aibou — Tasks

## Phase 0: Verification & Scaffold
- [x] Install and verify kiro-cli ACP command
- [x] Scaffold monorepo with pnpm workspaces
- [x] Create protocol package with AWP types
- [ ] Verify ACP permission request flow end-to-end

## Phase 1: Protocol + Mock Agent
- [x] Define all AWP frames as zod schemas
- [x] Create mock ACP agent
- [ ] Document protocol in docs/protocol.md

## Phase 2: Bridge Core
- [ ] Implement ACP JSON-RPC client
- [ ] Implement session manager
- [ ] Implement event ring buffer
- [ ] Implement HTTP + WebSocket server
- [ ] Implement auth (pairing + tokens)

## Phase 3: Permission Engine
- [ ] Implement policy engine
- [ ] Implement approval manager
- [ ] Create default policy rules
- [ ] Integration test: full approval loop

## Phase 4: PWA
- [ ] Pairing flow
- [ ] Session list + event stream
- [ ] Approval cards with approve/deny
- [ ] Prompt input + interrupt

## Phase 5: Wear OS
- [ ] Pair screen
- [ ] Status screen
- [ ] Approval screen with haptics
- [ ] Voice input (P1)

## Phase 6: Harden & Document
- [ ] README with full setup guide
- [ ] SECURITY.md
- [ ] Clean-machine test
- [ ] Coverage ≥ 70%
