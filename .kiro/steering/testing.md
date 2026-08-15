---
inclusion: always
---

# Testing Conventions

## Framework
- Use vitest for all TypeScript tests.
- Tests are colocated: `foo.test.ts` next to `foo.ts`.

## What to Test
- Policy engine: ≥20 positive and ≥10 negative cases for dangerous patterns.
- Ring buffer: replay with no gaps, no duplicates.
- Auth: constant-time compare, rate limiting, token generation.
- Normalization: ACP → AWP event mapping, including unknown fallback.

## Integration Tests
- Full loop: create session → prompt → permission request → approve → resolved.
- Use the mock agent package for deterministic scenarios.

## Commands
- `pnpm test` — run all tests
- `pnpm run check` — lint + typecheck + test
