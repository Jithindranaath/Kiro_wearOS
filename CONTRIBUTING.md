# Contributing — Aibou

## Prerequisites

- Node.js ≥ 20.11
- pnpm 9+
- Android Studio (for Wear OS app only)

## Setup

```bash
git clone <repo-url>
cd aibou
pnpm install
pnpm --filter @aibou/protocol build
```

## Development

```bash
# Run Bridge in dev mode (auto-restart on changes)
pnpm --filter @aibou/bridge dev

# Run Bridge in mock mode (no Kiro credentials needed)
pnpm --filter @aibou/bridge demo

# Run PWA dev server (hot reload)
pnpm --filter @aibou/pwa dev

# Run all tests
pnpm test

# Type check all packages
pnpm -r typecheck

# Full check (typecheck + test)
pnpm run check
```

## Project Structure

```
packages/
├── protocol/     # AWP types + zod schemas (shared)
├── bridge/       # Node.js daemon (ACP host, WS server, policy engine)
├── pwa/          # React PWA (Vite + Tailwind)
└── mock-agent/   # Fake ACP agent for tests/demo
wear/             # Wear OS app (standalone Gradle project)
```

## Code Conventions

- TypeScript with `"strict": true`, no `any` outside ACP boundary adapters
- Every inbound frame is zod-parsed, never type-cast with `as`
- Errors use typed `AibouError` with codes from `@aibou/protocol`
- Tests are colocated: `foo.test.ts` next to `foo.ts`
- `acp/methods.ts` and `acp/normalize.ts` are the ONLY files that know ACP's shape

## Testing

```bash
# Unit tests
pnpm --filter @aibou/bridge test

# Integration test (requires Bridge running in mock mode)
pnpm --filter @aibou/bridge demo &
node scripts/integration-test.mjs <pairing-code>
```

## Wear OS Build

```bash
cd wear
./gradlew assembleRelease
# APK: wear/app/build/outputs/apk/release/app-release.apk
```

**Emulator note:** The Bridge on the host machine is accessible at `10.0.2.2:8787` from inside the Wear OS emulator.
