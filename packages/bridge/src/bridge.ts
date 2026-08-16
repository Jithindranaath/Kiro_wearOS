/**
 * Bridge — the orchestrator that wires ACP client, session manager,
 * policy engine, approval manager, and the WebSocket server together.
 *
 * This is the core of Aibou: it spawns the Kiro ACP agent, intercepts
 * permission requests, evaluates them against the policy engine, and
 * relays decisions from connected clients (phone/watch) back to the agent.
 */

import { existsSync, readFileSync } from 'node:fs';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ExitCode } from '@aibou/protocol';
import { AcpClient } from './acp/client.js';
import { AcpMethods, type PermissionRequestParams, type SessionUpdateParams } from './acp/methods.js';
import { normalizeSessionUpdate } from './acp/normalize.js';
import { ToolCallRegistry } from './acp/toolcalls.js';
import { SessionManager, type SessionInfo } from './session/manager.js';
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

/**
 * Read the Bridge version from package.json so the value reported to clients
 * always matches the shipped build instead of a hand-maintained literal.
 */
function readBridgeVersion(): string {
  try {
    const here = join(fileURLToPath(import.meta.url), '..');
    const pkgPath = resolve(here, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const BRIDGE_VERSION = readBridgeVersion();

/** Commands that warrant the highest risk tier on the watch UI. */
const DESTRUCTIVE_COMMAND_RE =
  /\brm\s+-[a-z]*[rf]|\bsudo\b|\bdd\s+if=|\bmkfs\b|\bformat\s+[a-z]:|\bdel\s+\/[sq]\b|\bshutdown\b|\breboot\b|>\s*\/dev\/|\bchmod\s+777\b|\bgit\s+push\s+(--force|-f)\b/i;

export async function startBridge(options: BridgeOptions): Promise<void> {
  const { mock, host, port, paranoid, trace } = options;

  // ─── Resolve kiro-cli binary ─────────────────────────────────────────────

  /**
   * Format a SessionInfo into a session.state frame.
   * Maps `id` to `sessionId` per the AWP protocol.
   */
  function makeSessionStateFrame(info: SessionInfo) {
    return {
      v: 1 as const,
      t: 'session.state' as const,
      sessionId: info.id,
      cwd: info.cwd,
      status: info.status,
      statusSource: info.statusSource,
      statusReason: info.statusReason,
      pendingApprovals: info.pendingApprovals,
      lastActivity: info.lastActivity,
      ts: Date.now(),
    };
  }

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
  const toolCalls = new ToolCallRegistry();
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

  // Single shared wrapper for all ACP method calls.
  const methods = new AcpMethods(acpClient, BRIDGE_VERSION);

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

      // Remember tool call details so a later permission request (which only
      // carries toolCallId + title) can be resolved to the real command/input.
      if (
        update.sessionUpdate === 'tool_call' ||
        update.sessionUpdate === 'tool_call_update'
      ) {
        toolCalls.record(sessionId, update as unknown as Record<string, unknown>);
      }

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
        wsHub.broadcast(sessionId, makeSessionStateFrame(info));
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

    // Real kiro-cli sends a minimal toolCall here (id + title only). Merge in
    // the details captured from the earlier `tool_call` notification so policy
    // evaluation and client display operate on the real command/input.
    const remembered = toolCalls.get(toolCall.toolCallId);
    const kind = toolCall.kind ?? remembered?.kind;
    const rawInput = toolCall.rawInput ?? remembered?.rawInput;
    const title = toolCall.title ?? remembered?.title;
    // Prefer Kiro's own tool name (e.g. "shell") for rule matching; fall back
    // to the ACP kind, then the title.
    const policyToolName = remembered?.kiroToolName ?? kind ?? title ?? 'unknown';

    const riskTier = determineRiskTier(kind, rawInput);

    // Evaluate against policy engine
    const evaluation = policyEngine.evaluate({
      toolName: policyToolName,
      rawInput,
      cwd: sessionManager.getSession(sessionId)?.cwd ?? '',
    });

    if (evaluation.decision === 'allow') {
      // Auto-approve — respond immediately
      const optionId = pickOptionId(params.options, 'allow');
      acpClient.respond(acpRequestId, { outcome: { outcome: 'selected', optionId } });

      // Broadcast resolution (AC2.2.6 — policy auto-resolutions are still emitted)
      wsHub.broadcast(sessionId, {
        v: 1,
        t: 'permission.resolved',
        approvalId: randomBytes(16).toString('hex'),
        decision: 'allow',
        resolution: 'policy',
        ruleId: evaluation.ruleId,
        ts: Date.now(),
      });
      return;
    }

    if (evaluation.decision === 'deny') {
      // Auto-deny — respond immediately
      const optionId = pickOptionId(params.options, 'deny');
      acpClient.respond(acpRequestId, { outcome: { outcome: 'selected', optionId } });

      wsHub.broadcast(sessionId, {
        v: 1,
        t: 'permission.resolved',
        approvalId: randomBytes(16).toString('hex'),
        decision: 'deny',
        resolution: 'policy',
        ruleId: evaluation.ruleId,
        ts: Date.now(),
      });
      return;
    }

    // Escalate — hold the ACP response and notify clients.
    sessionManager.setAwaitingPermission(sessionId);

    // Pass the enriched toolCall so the summary and toolInput reflect reality.
    const enrichedParams: PermissionRequestParams = {
      ...params,
      toolCall: { ...toolCall, kind, rawInput, title },
    };

    const approval = approvalManager.createApproval(
      acpRequestId,
      enrichedParams,
      riskTier,
      policyToolName,
    );

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
      wsHub.broadcast(sessionId, makeSessionStateFrame(info));
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
      wsHub.broadcast(sessionId, makeSessionStateFrame(info));
    }
  });

  // ─── Handle client frames ─────────────────────────────────────────────────

  wsHub.on('authenticated', (client: ConnectedClient, id?: string) => {
    // Send hello frame
    wsHub.sendToClient(client, {
      v: 1,
      t: 'hello',
      id,
      bridgeVersion: BRIDGE_VERSION,
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
        wsHub.sendToClient(client, makeSessionStateFrame(info));
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
      const result = await methods.sessionNew(cwd);
      const info = sessionManager.createSession(result.sessionId, cwd);
      wsHub.sendToClient(client, { v: 1, t: 'ack', id: frame.id, ok: true, result: info, ts: Date.now() });
      // Broadcast session state to all clients
      wsHub.broadcast(info.id, makeSessionStateFrame(info));
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

  function handlePromptSend(client: ConnectedClient, frame: { id?: string; sessionId: string; text: string; source: string }): void {
    const { sessionId, text } = frame;
    const session = sessionManager.getSession(sessionId);

    if (!session) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_SESSION_NOT_FOUND',
        message: `Session not found: ${sessionId}`, retryable: false, ts: Date.now(),
      });
      return;
    }

    sessionManager.setWorking(sessionId);

    // ACP `session/prompt` does not resolve until the agent's whole turn ends,
    // which can take minutes. Ack the forwarding immediately (AC1.5.1) and let
    // turn progress arrive as `event` frames. The resolved value carries the
    // authoritative end-of-turn `stopReason`.
    methods
      .sessionPrompt(sessionId, text)
      .then((result) => {
        const stopReason = result?.stopReason ?? 'end_turn';
        sessionManager.completeTurn(sessionId, stopReason);
        const info = sessionManager.getSession(sessionId);
        if (info) {
          wsHub.broadcast(sessionId, makeSessionStateFrame(info));
        }
      })
      .catch((err: unknown) => {
        sessionManager.setError(sessionId, `Prompt failed: ${String(err)}`);
        const info = sessionManager.getSession(sessionId);
        if (info) {
          wsHub.broadcast(sessionId, makeSessionStateFrame(info));
        }
        wsHub.sendToClient(client, {
          v: 1, t: 'error', code: 'AIBOU_INTERNAL',
          message: `Prompt failed: ${String(err)}`, retryable: true, ts: Date.now(),
        });
      });

    wsHub.sendToClient(client, {
      v: 1,
      t: 'ack',
      id: frame.id,
      ok: true,
      result: { seq: sessionManager.getLatestSeq(sessionId) },
      ts: Date.now(),
    });
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

  function handleSessionInterrupt(client: ConnectedClient, frame: { id?: string; sessionId: string }): void {
    const { sessionId } = frame;

    if (!sessionManager.getSession(sessionId)) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_SESSION_NOT_FOUND',
        message: `Session not found: ${sessionId}`, retryable: false, ts: Date.now(),
      });
      return;
    }

    // Any held approvals must be released so the agent is not left blocked
    // on a prompt turn we are cancelling.
    approvalManager.cancelAllForSession(sessionId);

    // `session/cancel` is an ACP notification, so there is nothing to await.
    // The agent confirms by resolving the in-flight `session/prompt` request
    // with stopReason "cancelled", which completeTurn() then handles.
    try {
      methods.sessionCancel(sessionId);
    } catch (err) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_UNSUPPORTED',
        message: `Interrupt could not be sent: ${String(err)}`, retryable: false, ts: Date.now(),
      });
      return;
    }

    // AC1.5.2: acknowledge and broadcast within 1s.
    wsHub.sendToClient(client, { v: 1, t: 'ack', id: frame.id, ok: true, ts: Date.now() });
    const info = sessionManager.getSession(sessionId);
    if (info) {
      wsHub.broadcast(sessionId, makeSessionStateFrame(info));
    }
  }

  function broadcastAllSessionStates(): void {
    for (const info of sessionManager.listSessions()) {
      wsHub.broadcast(info.id, makeSessionStateFrame(info));
    }
  }

  /**
   * Choose the option id to send back to ACP for a given decision.
   *
   * Option ids are agent-defined — real kiro-cli uses `allow_once` /
   * `allow_always` / `reject_once`. Always resolve via the semantic `kind`
   * field and only fall back to a literal if the agent sent no usable option.
   */
  function pickOptionId(
    options: PermissionRequestParams['options'],
    decision: 'allow' | 'deny',
  ): string {
    const preferred: Array<PermissionRequestParams['options'][number]['kind']> =
      decision === 'allow' ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];

    for (const kind of preferred) {
      const match = options.find((o) => o.kind === kind);
      if (match) return match.optionId;
    }

    // No option advertised the expected kind — fall back to the agent's own
    // naming convention rather than inventing one.
    return decision === 'allow' ? 'allow_once' : 'reject_once';
  }

  /**
   * Classify risk from the ACP tool kind and the real command payload.
   *
   * Real kiro-cli reports shell commands with kind "execute"; the ACP spec also
   * allows "other". Both are treated as command execution.
   */
  function determineRiskTier(kind: string | undefined, rawInput: unknown): 'low' | 'medium' | 'high' {
    const input = (rawInput ?? undefined) as Record<string, unknown> | undefined;
    const command = typeof input?.command === 'string' ? input.command : '';

    const isCommandKind =
      kind === 'execute' || kind === 'shell' || kind === 'command';

    if (isCommandKind || command.length > 0) {
      if (DESTRUCTIVE_COMMAND_RE.test(command)) return 'high';
      return 'medium';
    }
    if (kind === 'delete') return 'high';
    if (kind === 'write' || kind === 'edit' || kind === 'move') return 'medium';
    return 'low';
  }

  // ─── Start everything ─────────────────────────────────────────────────────

  // Initialize ACP agent
  spawnAgent();

  // Initialize ACP session
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
    await createHttpServer({
      host,
      port,
      auth: authManager,
      wsHub,
      version: BRIDGE_VERSION,
    });
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

  console.log(
    [
      '',
      '┌──────────────────────────────────────────────────────┐',
      `│  ⛩️  Aibou Bridge v${BRIDGE_VERSION}`.padEnd(56) + '│',
      '├──────────────────────────────────────────────────────┤',
      `│  Mode:    ${mode}`.padEnd(56) + '│',
      `│  Server:  http://${host}:${port}`.padEnd(55) + '│',
      `│  Pairing: ${pairingCode}`.padEnd(55) + '│',
      '└──────────────────────────────────────────────────────┘',
      '',
      `🛡️  Policy: ${policyEngine.describe()}`,
      `📱 Pairing URL: ${pairingUrl}`,
      '',
    ].join('\n'),
  );

  if (policyEngine.policySource === 'invalid') {
    console.warn(
      '⚠️  Your policy.json could not be loaded, so EVERY action will ask for approval.\n' +
        '   Fix the file and restart, or delete it to use the built-in defaults.\n',
    );
  }

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
