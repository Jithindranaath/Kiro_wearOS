---
inclusion: always
---

# Aibou Project Conventions

## Code Style
- TypeScript with strict mode, no `any` outside ACP boundary adapters.
- Every inbound frame is zod-parsed. Never use `as` type assertions.
- Errors use typed `AibouError` with codes from the protocol package.
- One export per file for components; colocate tests as `*.test.ts`.

## Architecture Rules
- `acp/methods.ts` and `acp/normalize.ts` are the ONLY files that know ACP's shape.
- `packages/protocol` is the single source of truth for wire types.
- No database. Config is JSON files; events are in-memory ring buffers.

## Security
- Bridge binds to 127.0.0.1 by default. LAN binding requires explicit --host flag.
- Policy engine fails closed: unmatched rules escalate, never auto-approve.
- Deny rules always beat allow rules.
- Token comparison is constant-time.
- Never log tokens or toolInput at info level.

## Honesty Rule
- Never render a number the Bridge did not receive from a real ACP message.
- Where state is inferred, label it `inferred` in UI and document the heuristic.
- Mock mode must display a persistent, unsuppressible amber banner.
