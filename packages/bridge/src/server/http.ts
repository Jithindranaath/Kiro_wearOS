/**
 * HTTP Server — /api/pair, /api/health, /api/audit, static PWA serving.
 *
 * Built on Fastify with WebSocket support.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthManager } from './auth.js';
import { WsHub } from './ws.js';

export interface HttpServerOptions {
  host: string;
  port: number;
  auth: AuthManager;
  wsHub: WsHub;
  version: string;
  pwaPath?: string;
  /** Current Kiro account, for /api/account. Omit to disable the route. */
  account?: () => unknown;
  /**
   * Raise an approval on behalf of an external caller and resolve once answered.
   * Omit to disable /api/approval.
   */
  raiseApproval?: (input: {
    summary: string;
    toolName: string;
    toolInput?: unknown;
    riskTier: 'low' | 'medium' | 'high';
    sessionId: string;
    timeoutMs?: number;
  }) => Promise<{ decision: 'allow' | 'deny'; resolution: string; approvalId: string }>;
}

export async function createHttpServer(options: HttpServerOptions): Promise<FastifyInstance> {
  const { host, port, auth, wsHub, version, pwaPath, account, raiseApproval } = options;

  const app = Fastify({
    logger: false,
  });

  await app.register(fastifyWebsocket);

  // ─── WebSocket endpoint ────────────────────────────────────────────────────

  app.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (socket) => {
      wsHub.addClient(socket);
    });
  });

  // ─── API Routes ────────────────────────────────────────────────────────────

  app.post('/api/pair', async (request, reply) => {
    const body = request.body as { code?: string } | undefined;
    const code = body?.code;

    if (!code || typeof code !== 'string') {
      return reply.status(400).send({ error: 'Missing code' });
    }

    const clientIp = request.ip;

    if (auth.isRateLimited(clientIp)) {
      return reply.status(429).send({ error: 'Too many attempts. Try again later.' });
    }

    const token = auth.pair(code, clientIp);
    if (!token) {
      return reply.status(401).send({ error: 'Invalid or expired code' });
    }

    return reply.send({ token });
  });

  app.get('/api/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      version,
      uptime: process.uptime(),
      clients: wsHub.clientCount,
    });
  });

  /**
   * Which Kiro account the agent runs as.
   *
   * Read-only and unauthenticated, like /api/health, and it exposes no
   * credentials — only the state and whatever identity the CLI itself prints.
   * Sign-in and sign-out are deliberately not here: those go over the
   * authenticated WebSocket, so a paired device is required to change anything.
   */
  if (account) {
    app.get('/api/account', async (_request, reply) => reply.send(account()));
  }

  /**
   * Raise an approval from outside the ACP agent and wait for a human answer.
   *
   * This is what lets an editor gate itself: a Kiro IDE `preToolUse` hook posts
   * the tool it is about to run, this holds the request open while the watch
   * shows it, and the response carries the decision back so the hook can allow or
   * block the call.
   *
   * Requires a bearer token — anything that can raise an approval can also
   * interrupt the developer, so it is not open to unauthenticated callers.
   */
  if (raiseApproval) {
    app.post('/api/approval', async (request, reply) => {
      const header = request.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!auth.validateToken(token)) {
        return reply.status(401).send({ error: 'Invalid token' });
      }

      const body = (request.body ?? {}) as Record<string, unknown>;
      const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
      if (summary === '') {
        return reply.status(400).send({ error: 'summary is required' });
      }

      const riskTier =
        body.riskTier === 'low' || body.riskTier === 'medium' || body.riskTier === 'high'
          ? body.riskTier
          : 'medium';

      try {
        const outcome = await raiseApproval({
          summary,
          toolName: typeof body.toolName === 'string' ? body.toolName : 'external',
          toolInput: body.toolInput,
          riskTier,
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : 'external',
          timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
        });
        return reply.send(outcome);
      } catch (err) {
        return reply.status(500).send({ error: String(err) });
      }
    });
  }

  // ─── Static PWA serving ────────────────────────────────────────────────────

  let resolvedPwaPath: string;
  if (pwaPath) {
    resolvedPwaPath = pwaPath;
  } else {
    // Resolve relative to this file's location
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = join(thisFile, '..');
    resolvedPwaPath = resolve(thisDir, '../../../pwa/dist');
  }

  if (existsSync(resolvedPwaPath)) {
    await app.register(fastifyStatic, {
      root: resolvedPwaPath,
      prefix: '/',
      wildcard: true,
    });

    // SPA fallback — serve index.html for unmatched routes
    app.setNotFoundHandler(async (_request, reply) => {
      return reply.sendFile('index.html');
    });
  }

  // ─── Start ─────────────────────────────────────────────────────────────────

  await app.listen({ host, port });

  return app;
}
