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
import { AccountManager, type AccountInfo } from './account/manager.js';

export interface BridgeOptions {
  mock: boolean;
  host: string;
  port: number;
  paranoid: boolean;
  trace: boolean;
  /** Auto-deny an unanswered approval after this many ms (AC2.1.5). */
  approvalTimeoutMs: number;
  /** Events retained per session for replay (AC1.3.2). */
  eventBuffer: number;
  /** Concurrent session cap (AC1.2.3). */
  maxSessions: number;
  /** Forget all previously paired devices on startup. */
  revokeTokens?: boolean;
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

/**
 * One-line description of the Kiro account for the startup banner.
 *
 * Only ever renders values the CLI reported. An absent email is shown as such
 * rather than filled in with a placeholder that looks like data.
 */
function describeAccount(info: AccountInfo): string {
  switch (info.state) {
    case 'authenticated': {
      const who = info.email ?? info.accountType ?? 'signed in';
      return info.provider ? `${who} (${info.provider})` : who;
    }
    case 'unauthenticated':
      return 'not signed in — prompts will fail until you sign in';
    case 'authenticating':
      return 'sign-in in progress';
    case 'mock':
      return 'none — mock agent uses no account';
    case 'unavailable':
      return `unknown — ${info.reason ?? 'could not query kiro-cli'}`;
  }
}

/** Commands that warrant the highest risk tier on the watch UI. */
const DESTRUCTIVE_COMMAND_RE =
  /\brm\s+-[a-z]*[rf]|\bsudo\b|\bdd\s+if=|\bmkfs\b|\bformat\s+[a-z]:|\bdel\s+\/[sq]\b|\bshutdown\b|\breboot\b|>\s*\/dev\/|\bchmod\s+777\b|\bgit\s+push\s+(--force|-f)\b/i;

export async function startBridge(options: BridgeOptions): Promise<void> {
  const {
    mock,
    host,
    port,
    paranoid,
    trace,
    approvalTimeoutMs,
    eventBuffer,
    maxSessions,
    revokeTokens = false,
  } = options;

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
    // Prefer the compiled mock agent: plain JS, so it needs no TS loader and
    // works regardless of the current working directory. Fall back to the
    // TypeScript source via tsx only when running from source in dev.
    const here = join(fileURLToPath(import.meta.url), '..');
    const builtMock = resolve(here, '../../mock-agent/dist/index.js');
    const sourceMock = resolve(here, '../../mock-agent/src/index.ts');

    agentBin = process.execPath; // the node binary currently running

    if (existsSync(builtMock)) {
      agentArgs = [builtMock];
    } else if (existsSync(sourceMock)) {
      agentArgs = ['--import', 'tsx/esm', sourceMock];
    } else {
      console.error(
        `\n❌ Mock agent not found.\n` +
          `   Looked for: ${builtMock}\n` +
          `               ${sourceMock}\n` +
          `   Run: pnpm --filter @aibou/mock-agent build\n`,
      );
      process.exit(ExitCode.AGENT_UNAVAILABLE);
    }
  } else {
    agentBin = kiroBin;
    agentArgs = acpArgs;
  }

  // ─── Initialize components ────────────────────────────────────────────────

  const sessionManager = new SessionManager({ maxSessions, eventBuffer });
  const toolCalls = new ToolCallRegistry();
  const policyEngine = new PolicyEngine({ paranoid });
  const approvalManager = new ApprovalManager(approvalTimeoutMs);
  // The Kiro identity the agent runs as. Separate from device pairing below.
  const accountManager = new AccountManager({ kiroBin, mock });
  const authManager = new AuthManager();
  if (revokeTokens) {
    authManager.revokeAllTokens();
    console.log('🔓 All previously paired devices revoked; they must pair again.');
  }
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

  /** True once the handshake has succeeded at least once. */
  let everInitialized = false;

  acpClient.on('error', (err) => {
    console.error(`[bridge] ACP error: ${err.message}`);
  });

  // The binary could not be executed at all (e.g. ENOENT). Retrying will not
  // help, so fail fast with the documented exit code instead of exiting 0.
  acpClient.on('spawnFailed', (err: Error) => {
    console.error(
      `\n❌ Cannot start the Kiro ACP agent.\n` +
        `   ${err.message}\n` +
        `   Resolved binary: ${agentBin}\n` +
        `   Set AIBOU_KIRO_BIN to the full path of kiro-cli, or run with --mock.\n`,
    );
    process.exit(ExitCode.AGENT_UNAVAILABLE);
  });

  acpClient.on('exit', (code, signal) => {
    console.warn(`[bridge] Agent exited (code: ${code}, signal: ${signal})`);
    sessionManager.disconnectAll();
    broadcastAllSessionStates();

    // Never came up in the first place — respawning will not fix it.
    if (!everInitialized) {
      console.error(
        `\n❌ The agent exited before completing the ACP handshake.\n` +
          `   Resolved binary: ${agentBin}\n` +
          `   Check that it is a working kiro-cli, or run with --mock.\n`,
      );
      process.exit(ExitCode.AGENT_UNAVAILABLE);
    }

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

  // ─── Approvals raised from outside the ACP agent ──────────────────────────

  /**
   * Raise an approval for a caller that is not the ACP agent, and resolve when a
   * human answers it.
   *
   * The frame broadcast here is identical to an ACP-originated one, so the watch,
   * the notification and the PWA all treat it the same — there is deliberately no
   * second code path for "external" approvals to drift out of step.
   *
   * The policy engine is consulted first, exactly as for ACP requests, so an
   * auto-deny rule cannot be bypassed by asking over HTTP instead.
   */
  async function raiseApproval(input: {
    summary: string;
    toolName: string;
    toolInput?: unknown;
    riskTier: 'low' | 'medium' | 'high';
    sessionId: string;
    timeoutMs?: number;
  }): Promise<{ decision: 'allow' | 'deny'; resolution: string; approvalId: string }> {
    const evaluation = policyEngine.evaluate({
      toolName: input.toolName,
      rawInput: input.toolInput,
      cwd: sessionManager.getSession(input.sessionId)?.cwd ?? '',
    });

    if (evaluation.decision === 'allow' || evaluation.decision === 'deny') {
      const approvalId = randomBytes(16).toString('hex');
      wsHub.broadcast(null, {
        v: 1,
        t: 'permission.resolved',
        approvalId,
        decision: evaluation.decision,
        resolution: 'policy',
        ruleId: evaluation.ruleId,
        ts: Date.now(),
      });
      return { decision: evaluation.decision, resolution: 'policy', approvalId };
    }

    const approval = approvalManager.createExternalApproval({
      summary: input.summary,
      toolName: input.toolName,
      toolInput: input.toolInput,
      riskTier: input.riskTier,
      sessionId: input.sessionId,
      timeoutMs: input.timeoutMs,
    });

    wsHub.broadcast(null, {
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

    return new Promise((resolve) => {
      const onResolved = (resolution: { approvalId: string; decision: 'allow' | 'deny'; resolution: string }): void => {
        if (resolution.approvalId !== approval.approvalId) return;
        approvalManager.off('resolved', onResolved);
        resolve({
          decision: resolution.decision,
          resolution: resolution.resolution,
          approvalId: approval.approvalId,
        });
      };
      approvalManager.on('resolved', onResolved);
    });
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

  /** Format the current Kiro account as an account.state frame. */
  function makeAccountStateFrame(info: AccountInfo) {
    return {
      v: 1 as const,
      t: 'account.state' as const,
      state: info.state,
      accountType: info.accountType,
      provider: info.provider,
      email: info.email,
      verificationUri: info.verificationUri,
      userCode: info.userCode,
      reason: info.reason,
      ts: Date.now(),
    };
  }

  // Any change — sign-in, sign-out, a device code appearing — reaches every
  // client, so a watch and the PWA never disagree about who is signed in.
  accountManager.on('changed', (info: AccountInfo) => {
    wsHub.broadcast(null, makeAccountStateFrame(info));
  });

  wsHub.on('authenticated', (client: ConnectedClient, id?: string) => {
    // Send hello frame
    wsHub.sendToClient(client, {
      v: 1,
      t: 'hello',
      id,
      bridgeVersion: BRIDGE_VERSION,
      protocolVersion: 1,
      mode: mock ? 'mock' : 'live',
      capabilities: ['sessions', 'permissions', 'events', 'account'],
      ts: Date.now(),
    });

    // Follow immediately with who the agent is running as, so a client never
    // has to ask before it can render an account.
    wsHub.sendToClient(client, makeAccountStateFrame(accountManager.snapshot));
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
        void handlePromptSend(client, f as { id?: string; sessionId: string; text: string; source: string });
        break;
      case 'permission.respond':
        handlePermissionRespond(client, f as { id?: string; approvalId: string; decision: 'allow' | 'deny' });
        break;
      case 'session.interrupt':
        handleSessionInterrupt(client, f as { id?: string; sessionId: string });
        break;
      case 'session.close':
        handleSessionClose(client, f as { id?: string; sessionId: string });
        break;
      case 'account.status':
        void handleAccountStatus(client, f as { id?: string });
        break;
      case 'account.login':
        void handleAccountLogin(
          client,
          f as {
            id?: string;
            license?: 'free' | 'pro';
            social?: 'google' | 'github';
            identityProvider?: string;
            region?: string;
          },
        );
        break;
      case 'account.login.cancel':
        handleAccountLoginCancel(client, f as { id?: string });
        break;
      case 'account.logout':
        void handleAccountLogout(client, f as { id?: string });
        break;
    }
  });

  // ─── Account handlers ─────────────────────────────────────────────────────

  async function handleAccountStatus(
    client: ConnectedClient,
    frame: { id?: string },
  ): Promise<void> {
    const info = await accountManager.refresh();
    wsHub.sendToClient(client, {
      v: 1, t: 'ack', id: frame.id, ok: true, result: info, ts: Date.now(),
    });
  }

  async function handleAccountLogin(
    client: ConnectedClient,
    frame: {
      id?: string;
      license?: 'free' | 'pro';
      social?: 'google' | 'github';
      identityProvider?: string;
      region?: string;
    },
  ): Promise<void> {
    // Ack first: the device flow blocks until a human finishes in a browser,
    // which can take minutes. Progress arrives as account.state frames.
    wsHub.sendToClient(client, {
      v: 1, t: 'ack', id: frame.id, ok: true,
      result: accountManager.snapshot, ts: Date.now(),
    });

    try {
      await accountManager.login({
        license: frame.license,
        social: frame.social,
        identityProvider: frame.identityProvider,
        region: frame.region,
      });
    } catch (err) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', code: 'AIBOU_INTERNAL',
        message: `Sign-in failed: ${String(err)}`, retryable: true, ts: Date.now(),
      });
    }
  }

  function handleAccountLoginCancel(client: ConnectedClient, frame: { id?: string }): void {
    const info = accountManager.cancelLogin();
    wsHub.sendToClient(client, {
      v: 1, t: 'ack', id: frame.id, ok: true, result: info, ts: Date.now(),
    });
  }

  async function handleAccountLogout(
    client: ConnectedClient,
    frame: { id?: string },
  ): Promise<void> {
    const info = await accountManager.logout();
    wsHub.sendToClient(client, {
      v: 1, t: 'ack', id: frame.id, ok: true, result: info, ts: Date.now(),
    });
  }

  async function handleSessionCreate(client: ConnectedClient, frame: { id?: string; cwd: string }): Promise<void> {
    const { cwd } = frame;

    if (!existsSync(cwd)) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_BAD_CWD',
        message: `Directory does not exist: ${cwd}`, retryable: false, ts: Date.now(),
      });
      return;
    }

    // A session that has errored or lost its agent can never be used again, so
    // holding a slot for it only turns the cap into a dead end. Reclaim those
    // before refusing, and say so rather than silently discarding state.
    if (sessionManager.atCapacity) {
      const dead = sessionManager
        .listSessions()
        .filter((s) => s.status === 'error' || s.status === 'disconnected');

      for (const s of dead) {
        approvalManager.cancelAllForSession(s.id);
        sessionManager.removeSession(s.id);
      }
      if (dead.length > 0) {
        console.log(
          `[bridge] Reclaimed ${dead.length} unusable session(s) to make room: ` +
            dead.map((s) => `${s.id.slice(0, 8)} (${s.status})`).join(', '),
        );
      }
    }

    // Still full: every slot holds a live session, so this is a real refusal.
    if (sessionManager.atCapacity) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_SESSION_LIMIT',
        message:
          `Session limit reached (${sessionManager.limit}). ` +
          `Close one with session.close, or from the session list in the web app.`,
        retryable: false, ts: Date.now(),
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

    // Fail here with something actionable rather than letting the agent fail
    // opaquely several seconds later. Re-reads the CLI first, so a cached
    // reading that has since gone stale never refuses work that would succeed.
    if (!(await accountManager.verifyAuthenticated())) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_UNAUTHENTICATED',
        message: 'No Kiro account is signed in. Sign in from Aibou, or run: kiro-cli login',
        retryable: true, ts: Date.now(),
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

    // Only ACP approvals have a held request to answer. An external one — a Kiro
    // IDE hook, say — is waiting on its HTTP response, which the resolution event
    // delivers; replying here would target a request id that does not exist.
    if (result.origin === 'acp') {
      acpClient.respond(result.acpRequestId, {
        outcome: { outcome: 'selected', optionId: result.optionId },
      });
    }

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

  /**
   * Close a session and free its slot.
   *
   * Cancels anything in flight first, so the agent is never left blocked on an
   * approval for a session that no longer exists. The final `disconnected` state
   * is broadcast before removal so clients can drop it from their lists.
   */
  function handleSessionClose(client: ConnectedClient, frame: { id?: string; sessionId: string }): void {
    const { sessionId } = frame;

    if (!sessionManager.getSession(sessionId)) {
      wsHub.sendToClient(client, {
        v: 1, t: 'error', id: frame.id, code: 'AIBOU_SESSION_NOT_FOUND',
        message: `Session not found: ${sessionId}`, retryable: false, ts: Date.now(),
      });
      return;
    }

    approvalManager.cancelAllForSession(sessionId);
    try {
      methods.sessionCancel(sessionId);
    } catch {
      // The agent may already have dropped it; closing our side still matters.
    }

    sessionManager.setDisconnected(sessionId);
    const info = sessionManager.getSession(sessionId);
    if (info) wsHub.broadcast(sessionId, makeSessionStateFrame(info));

    sessionManager.removeSession(sessionId);
    wsHub.sendToClient(client, { v: 1, t: 'ack', id: frame.id, ok: true, ts: Date.now() });
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
    everInitialized = true;
    console.log(`✅ ACP agent initialized: ${initResult.agentInfo.name} v${initResult.agentInfo.version}`);
    console.log(`   Protocol: v${initResult.protocolVersion}`);
    console.log(`   Capabilities: loadSession=${initResult.agentCapabilities.loadSession}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `\n❌ ACP handshake failed.\n` +
        `   ${message}\n` +
        `   Resolved binary: ${agentBin}\n` +
        `   Set AIBOU_KIRO_BIN to the full path of kiro-cli, or run with --mock.\n`,
    );
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
      account: () => accountManager.snapshot,
      raiseApproval,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('EADDRINUSE')) {
      // Almost always another Bridge (often `pnpm run demo` in a second
      // terminal), so name that case and offer both ways out. The agent has
      // already spawned by this point; kill it so we do not leak the process.
      acpClient.kill();
      console.error(
        `\n❌ Port ${port} is already in use — most likely another Bridge is running.\n\n` +
          `   Who has it:\n` +
          (process.platform === 'win32'
            ? `     Get-NetTCPConnection -LocalPort ${port} -State Listen | ` +
              `ForEach-Object { Get-Process -Id $_.OwningProcess }\n`
            : `     lsof -nP -iTCP:${port} -sTCP:LISTEN\n`) +
          `\n   Then either stop it, or run this one beside it:\n` +
          `     aibou --port ${port + 1}\n\n` +
          `   Note that a paired watch or phone points at one port, so if you\n` +
          `   change it you will need to re-pair that device.\n`,
      );
      process.exit(ExitCode.PORT_IN_USE);
    }
    throw err;
  }

  // Start heartbeat
  wsHub.startHeartbeat();

  // Who is the agent running as? Ask before printing the banner so the operator
  // learns about a missing sign-in here, rather than from a failing prompt later.
  const account = await accountManager.refresh();

  // Keep watching: signing in or out with the CLI happens outside Aibou and
  // emits no event, so a one-time reading would go stale and every client would
  // keep showing whatever was true at startup.
  accountManager.startWatching();

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
      `👤 Kiro account: ${describeAccount(account)}`,
      `🛡️  Policy: ${policyEngine.describe()}`,
      `🔗 Paired devices: ${
        authManager.knownTokenCount === 0
          ? 'none yet — enter the code above on your phone or watch'
          : `${authManager.knownTokenCount} remembered (they reconnect automatically)`
      }`,
      `📱 Pairing URL: ${pairingUrl}`,
      '',
    ].join('\n'),
  );

  if (account.state === 'unauthenticated') {
    console.warn(
      '⚠️  No Kiro account is signed in, so prompts will fail until one is.\n' +
        '   Sign in from the Aibou web app, or run: kiro-cli login\n' +
        '   The session then persists until you sign out from Aibou.\n',
    );
  } else if (account.state === 'unavailable') {
    console.warn(`⚠️  Could not determine the Kiro account: ${account.reason ?? 'unknown'}\n`);
  }

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
    accountManager.stopWatching();
    accountManager.cancelLogin();
    acpClient.kill();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
