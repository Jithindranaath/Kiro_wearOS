/**
 * Bridge orchestrator — wires together ACP client, session manager,
 * policy engine, approval manager, and the server.
 */

export interface BridgeOptions {
  mock: boolean;
  host: string;
  port: number;
  paranoid: boolean;
  trace: boolean;
}

export async function startBridge(options: BridgeOptions): Promise<void> {
  console.log(`
┌─────────────────────────────────────────┐
│          ⛩️  Aibou Bridge v1.0.0         │
├─────────────────────────────────────────┤
│  Mode: ${options.mock ? 'MOCK (no real Kiro session)' : 'LIVE'}${options.mock ? '' : '                  '}  │
│  Host: ${options.host.padEnd(30)}│
│  Port: ${String(options.port).padEnd(30)}│
└─────────────────────────────────────────┘
`);

  // TODO: Phase 2 — wire up components:
  // 1. Spawn ACP agent (or mock agent)
  // 2. Initialize policy engine
  // 3. Start HTTP + WS server
  // 4. Generate pairing code + QR
  // 5. Begin event loop

  console.log('🚧 Bridge scaffold ready. Implementation coming in Phase 2.');
}
