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
}

export async function createHttpServer(options: HttpServerOptions): Promise<FastifyInstance> {
  const { host, port, auth, wsHub, version, pwaPath } = options;

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
