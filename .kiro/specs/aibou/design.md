# Aibou — Design

## Architecture
See `architect.md` in the project root for the full system architecture.

## Key Design Decisions
1. Bridge hosts Kiro as ACP subprocess (not attach to TUI) — owns the permission flow.
2. TypeScript monorepo for Bridge + Protocol + PWA; Kotlin for Wear OS.
3. PWA covers both iOS and Android; no native mobile apps.
4. Wear OS app is standalone (direct WebSocket), not phone-companion.
5. In-memory event ring buffer + JSON config; no database.
6. Permission policy engine is the core differentiator.

## Wire Protocol (AWP)
JSON over WebSocket. See `packages/protocol/` for full type definitions.
