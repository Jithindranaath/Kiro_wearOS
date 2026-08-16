/**
 * Bridge — the orchestrator that wires ACP client, session manager,
 * policy engine, approval manager, and the WebSocket server together.
 *
 * This is the core of Aibou: it spawns the Kiro ACP agent, intercepts
 * permission requests, evaluates them against the policy engine, and
 * relays decisions from connected clients (phone/watch) back to the agent.
 */

import { existsSync } from 'node:fs';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ExitCode } from '@aibou/protocol';
import { AcpClient } from './acp/client.js';
import { AcpMethods, type PermissionRequestParams, type SessionUpdateParams } from './acp/methods.js';
import { normalizeSessionUpdate } from './acp/normalize.js';
import { SessionManager } from './session/manager.js';
import { PolicyEngine } from './policy/engine.js';
import { ApprovalManager } from './approval/manager.js';
import { AuthManager } from './server/auth.js';
import { WsHub, type ConnectedClient } from './server/ws.js';
import { createHttpServer } from './server/http.js';

export interface BridgeOptions {
  mock: boolean;
  host: string;
  port: number;
  paranoid: boolean;
  trace: boolean;
}

export async function startBridge(options: BridgeOptions): Promise<void> {
  const { mock, host, port, paranoid, trace } = options;

  // ─── Resolve kiro-cli binary ─────────────────────────────────────────────

  const kiroBin = process.env.AIBOU_KIRO_BIN ?? 'kiro-cli';
  const acpArgs = ['acp'];

  let agentBin: string;
  let agentArgs: string[];

  if (mock) {
    // Use mock agent — spawn node with tsx loader
    const mockPath = join(import.meta.dirname ?? __dirname, '../../mock-agent/src/index.ts');
    agentBin = process.execPath; // current node binary
    agentArgs = ['--import', 'tsx/esm', mockPath];
  } else {
    agentBin = kiroBin;
    agentArgs = acpArgs;
  }

  // ─── Initialize components ────────────────────────────────────────────────

  const sessionManager = new SessionManager();
  const policyEngine = new PolicyEngine(paranoid);
  const approvalManager = new ApprovalManager();
  const authManager = new AuthManager();
  const wsHub = new WsHub(authManager);

  // ─── Trace logging ────────────────────────────────────────────────────────

  let traceLog: ((direction: 'in' | 'out', frame: unknown) => void) | undefined;
  if (trace) {
    const logDir = join(homedir(), '.aibou', 'logs');
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, `acp-${new Date().toISOString().split('T')[0]}.jsonl`);
    traceLog = (direction, frame) => {
      const entry = { ts: Date.now(), dir: direction, frame };
      appendFileSync(logFile, JSON.stringify(entry) + '\n');
    };
  }

  // ─── Spawn ACP agent ──────────────────────────────────────────────────────

  const acpClient = new AcpClient({ kiroBin: agentBin, args: agentArgs, trace, traceLog });

  let respawnCount = 0;
  const MAX_RESPAWNS = 3;
  const RESPAWN_DELAYS = [1000, 2000, 4000];

  function spawnAgent(): void {
    try {
      acpClient.spawn();
    } catch (err) {
      console.error(`❌ Failed to spawn agent: ${err}`);
      process.exit(ExitCode.AGENT_UNAVAILABLE);
    }
  }

  acpClient.on('error', (err) => {
    console.error(`[bridge] ACP error: ${err.message}`);
  });

  acpClient.on('exit', (code, signal) => {
    console.warn(`[bridge] Agent exited (code: ${code}, signal: ${signal})`);
    sessionManager.disconnectAll();
    broadcastAllSessionStates();

    if (respawnCount < MAX_RESPAWNS) {
      const delay = RESPAWN_DELAYS[respawnCount] ?? 4000;
      respawnCount++;
      console.log(`[bridge] Respawning agent in ${delay}ms (attempt ${respawnCount}/${MAX_RESPAWNS})...`);
      setTimeout(() => spawnAgent(), delay);
    } else {
      console.error('[bridge] Max respawn attempts reached. Exiting.');
      process.exit(ExitCode.AGENT_UNAVAILABLE);
    }
  });

  // ─── Handle ACP notifications (session/update) ────────────────────────────

  acpClient.on('notification', (method: string, params: unknown) => {
    if (method === 'session/update' || method === 'session/notification') {
      const updateParams = params as SessionUpdateParams;
      const { sessionId, update } = updateParams;

      // Normalize and push to event buffer
      const event = normalizeSessionUpdate(updateParams);
      sessionManager.pushEvent(sessionId, event);

      // Update session status
      sessionManager.updateStatus(sessionId, update);

      // Broadcast event to subscribed clients
      const seq = sessionManager.getLatestSeq(sessionId);
      wsHub.broadcast(sessionId, {
        v: 1,
        t: 'event',
        sessionId,
        seq,
        kind: event.kind,
        payload: event.payload,
        ts: Date.now(),
      });

      // Broadcast updated session state
      const info = sessionManager.getSession(sessionId);
      if (info) {
        wsHub.broadcast(sessionId, {
          v: 1,
          t: 'session.state',
          ...info,
          ts: Date.now(),
        });
      }
    }
  });

  // ─── Handle ACP requests (session/request_permission) ─────────────────────

  acpClient.on('request', (id: number | string, method: string, params: unknown) => {
    if (method === 'session/request_permission') {
      handlePermissionRequest(id, params as PermissionRequestParams);
    }
  });

  function handlePermissionRequest(acpRequestId: number | string, params: PermissionRequestParams): void {
    const { sessionId, toolCall } = params;

    // Determine risk tier based on tool kind
    const riskTier = determineRiskTier(toolCall.kind, toolCall.rawInput);

    // Evaluate against policy engine
    const evaluation = policyEngine.evaluate({
      toolName: toolCall.title ?? toolCall.kind ?? 'unknown',
      rawInput: toolCall.rawInput,
      cwd: sessionManager.getSession(sessionId)?.cwd ?? '',
    });

    if (evaluation.decision === 'allow') {
      // Auto-approve — respond immediately
      const optionId = params.options.find((o) => o.kind === 'allow_once')?.optionId ?? 'allow-once';
      acpClient.respond(acpRequestId, { outcome: { outcome: 'selected', optionId } });

      // Broadcast resolution (AC2.2.6 — policy auto-resolutions are still emitted)
      wsHub.broadcast(sessionId, {
        v: 1,
        t: 'permission.resolved',
        approvalId: `policy_${Date.now()}`,
        decision: 'allow',
        resolution: 'policy',
        ruleId: evaluation.ruleId,
        ts: Date.now(),
      });
      return;
    }

    if (evaluation.decision === 'deny') {
      // Auto-deny — respond immediately
      const optionId = params.options.find((o) => o.kind === 'reject_once')?.optionId ?? 'reject-once';
      acpClient.respond(acpRequestId, { outcome: { outcome: 'selected', optionId } });

      wsHub.broadcast(sessionId, {
        v: 1,
        t: 'permission.resolved',
        approvalId: `policy_${Date.now()}`,
        decision: 'deny',
        resolution: 'policy',
        ruleId: evaluation.ruleId,
        ts: Date.now(),
      });
      return;
    }

    // Escalate — hold the ACP response and notify clients
    sessionManager.setAwaitingPermission(sessionId);

    const approval = approvalManager.createApproval(acpRequestId, params, riskTier);

    // Broadcast permission request to all clients
    wsHub.broadcast(sessionId, {
      v: 1,
      t: 'permission.request',
      approvalId: approval.approvalId,
      sessionId: approval.sessionId,
      toolName: approval.toolName,
      summary: approval.summary,
      toolInput: approval.toolInput,
      riskTier: approval.riskTier,
      expiresAt: approval.expiresAt,
      ts: Date.now(),
    });

    // Broadcast updated session state
    const info = sessionManager.getSession(sessionId);
    if (info) {
      wsHub.broadcast(sessionId, {
        v: 1,
        t: 'session.state',
        ...info,
        ts: Date.now(),
      });
    }
  }

  // ─── Handle approval resolutions ──────────────────────────────────────────

  approvalManager.on('resolved', (resolution, sessionId) => {
    sessionManager.resolvePermission(sessionId);

    // Broadcast resolution
    wsHub.broadcast(sessionId, {
      v: 1,
      t: 'permission.resolved',
      ...resolution,
      ts: Date.now(),
    });

    // Broadcast updated session state
    const info = sessionManager.getSession(sessionId);
    if (info) {
      wsHub.broadcast(sessionId, {
        v: 1,
        t: 'session.state',
        ...info,
        ts: Date.now(),
      });
    }
  });

  // ─── Handle client frames ─────────────────────────────────────────────────

  wsHub.on('authenticated', (client: ConnectedClient, id?: string) => {
    // Send hello frame
    wsHub.sendToClient(client, {
      v: 1,
      t: 'hello',
      id,
      bridgeVersion: '1.0.0',
      protocolVersion: 1,
      mode: mock ? 'mock' : 'live',
      capabilities: ['sessions', 'permissions', 'events'],
      ts: Date.now(),
    });
  });

  wsHub.on('subscribe', (client: ConnectedClient, sessionId: string | undefined, since: number | undefined, id?: string) => {
    // Replay events since the given seq
    const sessions = sessionId
      ? [sessionId]
      : sessionManager.listSessions().map((s) => s.id);

    for (const sid of sessions) {
      const events = sessionManager.getEventsSince(sid, since ?? 0);
      for (const event of events) {
        wsHub.sendToClient(client, {
          v: 1,
          t: 'event',
          sessionId: sid,
          seq: event.seq,
          kind: event.kind,
          payload: event.payload,
          ts: event.timestamp,
        });
      }

      // Send current session state
      const info = sessionManager.getSession(sid);
      if (info) {
        wsHub.sendToClient(client, {
          v: 1,
          t: 'session.state',
          ...info,
          ts: Date.now(),
        });
      }
    }

    // Send pending approvals
    const pending = sessionId
      ? approvalManager.getPendingForSession(sessionId)
      : approvalManager.getPending();

    for (const approval of pending) {
      wsHub.sendToClient(client, {
        v: 1,
        t: 'permission.request',
        approvalId: approval.approvalId,
        sessionId: approval.sessionId,
        toolName: approval.toolName,
        summary: approval.summary,
        toolInput: approval.toolInput,
        riskTier: approval.riskTier,
        expiresAt: approval.expiresAt,
        ts: Date.now(),
      });
    }

    // Ack
    wsHub.sendToClient(client, { v: 1, t: 'ack', id, ok: true, ts: Date.now() });
  });

  wsHub.on('clientFrame', (client: ConnectedClient, frame: unknown) => {
    const f = frame as Record<string, unknown>;

    switch (f.t) {
      case 'session.create':
        handleSessionCreate(client, f as { id?: string; cwd: string });
        break;
      case 'session.list':
        handleSessionList(client, f as { id?: string });
        break;
      case 'prompt.send':
        handlePromptSend(client, f as { id?: string; sessionId: string; text: string; source: string });
        break;
      case 'permission.respond':
        handlePermissionRespond(client, f as { id?: string; approvalId: string; decision: 'allow' | 'deny' });
        break;
      case 'session.interrupt':
        handleSessionInterrupt(client, f as { id?: string; sessionId: string });
        break;
    }
  });

  async function handleSessionCreate(client: ConnectedClient, frame: { id?: string; cwd: string }): Promise<void> {
    const { cwd } = frame;

    if (!existsSync(cwd)) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_BAD_CWD',
        message: `Directory does not exist: ${cwd}`, retryable: false, ts: Date.now(),
      });
      return;
    }

    try {
      const methods = new AcpMethods(acpClient);
      const result = await methods.sessionNew(cwd);
      const info = sessionManager.createSession(result.sessionId, cwd);
      wsHub.sendToClient(client, { v: 1, t: 'ack', id: frame.id, ok: true, result: info, ts: Date.now() });
    } catch (err) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_INTERNAL',
        message: `Failed to create session: ${err}`, retryable: true, ts: Date.now(),
      });
    }
  }

  function handleSessionList(client: ConnectedClient, frame: { id?: string }): void {
    const sessions = sessionManager.listSessions();
    wsHub.sendToClient(client, { v: 1, t: 'ack', id: frame.id, ok: true, result: sessions, ts: Date.now() });
  }

  async function handlePromptSend(client: ConnectedClient, frame: { id?: string; sessionId: string; text: string; source: string }): Promise<void> {
    const { sessionId, text } = frame;
    const session = sessionManager.getSession(sessionId);

    if (!session) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_SESSION_NOT_FOUND',
        message: `Session not found: ${sessionId}`, retryable: false, ts: Date.now(),
      });
      return;
    }

    try {
      const methods = new AcpMethods(acpClient);
      sessionManager.setWorking(sessionId);
      await methods.sessionPrompt(sessionId, text);
      wsHub.sendToClient(client, { v: 1, t: 'ack', id: frame.id, ok: true, ts: Date.now() });
    } catch (err) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_INTERNAL',
        message: `Failed to send prompt: ${err}`, retryable: true, ts: Date.now(),
      });
    }
  }

  function handlePermissionRespond(client: ConnectedClient, frame: { id?: string; approvalId: string; decision: 'allow' | 'deny' }): void {
    const { approvalId, decision } = frame;

    const result = approvalManager.resolveApproval(approvalId, decision, 'user');

    if (!result) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_ALREADY_RESOLVED',
        message: 'This approval has already been resolved.', retryable: false, ts: Date.now(),
      });
      return;
    }

    // Respond to the ACP agent
    acpClient.respond(result.acpRequestId, {
      outcome: { outcome: 'selected', optionId: result.optionId },
    });

    wsHub.sendToClient(client, { v: 1, t: 'ack', id: frame.id, ok: true, ts: Date.now() });
  }

  async function handleSessionInterrupt(client: ConnectedClient, frame: { id?: string; sessionId: string }): Promise<void> {
    const { sessionId } = frame;

    try {
      const methods = new AcpMethods(acpClient);
      await methods.sessionCancel(sessionId);

      // Cancel pending approvals for this session
      approvalManager.cancelAllForSession(sessionId);

      wsHub.sendToClient(client, { v: 1, t: 'ack', id: frame.id, ok: true, ts: Date.now() });
    } catch (err) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_UNSUPPORTED',
        message: `Interrupt not supported: ${err}`, retryable: false, ts: Date.now(),
      });
    }
  }

  function broadcastAllSessionStates(): void {
    for (const info of sessionManager.listSessions()) {
      wsHub.broadcast(info.id, {
        v: 1,
        t: 'session.state',
        ...info,
        ts: Date.now(),
      });
    }
  }

  function determineRiskTier(kind: string | undefined, rawInput: unknown): 'low' | 'medium' | 'high' {
    if (kind === 'shell' || kind === 'command') {
      const input = rawInput as Record<string, unknown> | undefined;
      const command = (input?.command as string) ?? '';
      // High risk: destructive commands
      if (/rm\s+-rf|sudo|dd\s+|mkfs|format\s+/i.test(command)) return 'high';
      return 'medium';
    }
    if (kind === 'delete') return 'high';
    if (kind === 'write' || kind === 'edit') return 'medium';
    return 'low';
  }

  // ─── Start everything ─────────────────────────────────────────────────────

  // Initialize ACP agent
  spawnAgent();

  // Initialize ACP session
  const methods = new AcpMethods(acpClient);
  try {
    const initResult = await methods.initialize();
    console.log(`✅ ACP agent initialized: ${initResult.agentInfo.name} v${initResult.agentInfo.version}`);
    console.log(`   Protocol: v${initResult.protocolVersion}`);
    console.log(`   Capabilities: loadSession=${initResult.agentCapabilities.loadSession}`);
  } catch (err) {
    console.error(`❌ Failed to initialize ACP agent: ${err}`);
    process.exit(ExitCode.AGENT_UNAVAILABLE);
  }

  // Start HTTP + WS server
  try {
    await createHttpServer({ host, port, auth: authManager, wsHub: wsHub });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('EADDRINUSE')) {
      console.error(`❌ Port ${port} is already in use.`);
      process.exit(ExitCode.PORT_IN_USE);
    }
    throw err;
  }

  // Start heartbeat
  wsHub.startHeartbeat();

  // Display startup info
  const mode = mock ? '🟡 MOCK MODE (not a real Kiro session)' : '🟢 LIVE';
  const pairingCode = authManager.getPairingCode();
  const pairingUrl = authManager.getPairingUrl(host === '127.0.0.1' ? 'localhost' : host, port);

  console.log(`
┌─────────────────────────────────────────────┐
│          ⛩️  Aibou Bridge v1.0.0             │
├─────────────────────────────────────────────┤
│  Mode:    ${mode.padEnd(33)}│
│  Server:  http://${host}:${port}${' '.repeat(Math.max(0, 19 - host.length - String(port).length))}│
│  Pairing: ${pairingCode}                              │
└─────────────────────────────────────────────┘

📱 Pairing URL: ${pairingUrl}
`);

  // Generate QR code for pairing
  try {
    const qrcode = await import('qrcode-terminal');
    qrcode.generate(pairingUrl, { small: true });
  } catch {
    // qrcode-terminal not available, skip
  }

  // Graceful shutdown
  const shutdown = (): void => {
    console.log('\n🛑 Shutting down...');
    wsHub.stopHeartbeat();
    acpClient.kill();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
