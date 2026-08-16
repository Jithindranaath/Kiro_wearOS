/**
 * WebSocket Hub — AWP fan-out, auth gate, subscribe + replay, heartbeat.
 *
 * Manages all connected WebSocket clients:
 * - Auth requirement within 5 seconds (AC3.2.5)
 * - Subscribe with replay-since (AC1.3.3)
 * - Fan-out of events, session state, and permission frames
 * - Heartbeat every 20s, close on 3 missed pongs (AC3.3.1)
 */

import { EventEmitter } from 'node:events';
import type { WebSocket } from '@fastify/websocket';
import { ClientFrame } from '@aibou/protocol';
import { AuthManager } from './auth.js';

export interface ConnectedClient {
  ws: WebSocket;
  authenticated: boolean;
  subscribedSessions: Set<string>; // empty = all sessions
  lastSeq: Map<string, number>; // per session: last seq sent to this client
  missedPongs: number;
  authTimer: ReturnType<typeof setTimeout> | null;
}

export class WsHub extends EventEmitter {
  private clients = new Set<ConnectedClient>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly auth: AuthManager;

  private readonly AUTH_TIMEOUT_MS = 5000;
  private readonly HEARTBEAT_INTERVAL_MS = 20_000;
  private readonly MAX_MISSED_PONGS = 3;

  constructor(auth: AuthManager) {
    super();
    this.auth = auth;
  }

  /**
   * Start the heartbeat loop.
   */
  startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeats();
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop the heartbeat loop.
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Register a new WebSocket connection.
   */
  addClient(ws: WebSocket): ConnectedClient {
    const client: ConnectedClient = {
      ws,
      authenticated: false,
      subscribedSessions: new Set(),
      lastSeq: new Map(),
      missedPongs: 0,
      authTimer: null,
    };

    // Require auth within 5 seconds (AC3.2.5)
    client.authTimer = setTimeout(() => {
      if (!client.authenticated) {
        this.closeClient(client, 4401, 'Authentication timeout');
      }
    }, this.AUTH_TIMEOUT_MS);

    this.clients.add(client);

    ws.on('message', (data: { toString(): string }) => {
      this.handleMessage(client, data.toString());
    });

    ws.on('close', () => {
      this.removeClient(client);
    });

    ws.on('error', () => {
      this.removeClient(client);
    });

    return client;
  }

  /**
   * Broadcast a frame to all authenticated, subscribed clients.
   */
  broadcast(sessionId: string | null, frame: unknown): void {
    const data = JSON.stringify(frame);
    for (const client of this.clients) {
      if (!client.authenticated) continue;
      if (sessionId && client.subscribedSessions.size > 0 && !client.subscribedSessions.has(sessionId)) {
        continue;
      }
      this.safeSend(client, data);
    }
  }

  /**
   * Send a frame to a specific client.
   */
  sendToClient(client: ConnectedClient, frame: unknown): void {
    if (!client.authenticated) return;
    this.safeSend(client, JSON.stringify(frame));
  }

  /**
   * Get count of connected, authenticated clients.
   */
  get clientCount(): number {
    let count = 0;
    for (const c of this.clients) {
      if (c.authenticated) count++;
    }
    return count;
  }

  private handleMessage(client: ConnectedClient, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.sendError(client, undefined, 'AIBOU_BAD_FRAME', 'Invalid JSON', false);
      return;
    }

    // Parse with zod
    const result = ClientFrame.safeParse(parsed);
    if (!result.success) {
      this.sendError(client, (parsed as Record<string, unknown>)?.id as string | undefined, 'AIBOU_BAD_FRAME', 'Invalid frame format', false);
      return;
    }

    const frame = result.data;

    // First frame must be auth (AC3.2.6)
    if (!client.authenticated && frame.t !== 'auth') {
      this.closeClient(client, 4401, 'First frame must be auth');
      return;
    }

    switch (frame.t) {
      case 'auth':
        this.handleAuth(client, frame.token, frame.id);
        break;
      case 'subscribe':
        this.handleSubscribe(client, frame.sessionId, frame.since, frame.id);
        break;
      case 'pong':
        client.missedPongs = 0;
        break;
      default:
        // Forward other frames to bridge for handling
        this.emit('clientFrame', client, frame);
        break;
    }
  }

  private handleAuth(client: ConnectedClient, token: string, id?: string): void {
    if (this.auth.validateToken(token)) {
      client.authenticated = true;
      if (client.authTimer) {
        clearTimeout(client.authTimer);
        client.authTimer = null;
      }
      // Send hello
      this.emit('authenticated', client, id);
    } else {
      this.sendError(client, id, 'AIBOU_UNAUTHORIZED', 'Invalid token', false);
      setTimeout(() => this.closeClient(client, 4401, 'Unauthorized'), 100);
    }
  }

  private handleSubscribe(client: ConnectedClient, sessionId: string | undefined, since: number | undefined, id?: string): void {
    if (sessionId) {
      client.subscribedSessions.add(sessionId);
    }
    // Emit subscribe event so bridge can replay events
    this.emit('subscribe', client, sessionId, since, id);
  }

  private sendHeartbeats(): void {
    const frame = JSON.stringify({ v: 1, t: 'heartbeat', ts: Date.now() });
    for (const client of this.clients) {
      if (!client.authenticated) continue;
      client.missedPongs++;
      if (client.missedPongs > this.MAX_MISSED_PONGS) {
        this.closeClient(client, 4408, 'Heartbeat timeout');
        continue;
      }
      this.safeSend(client, frame);
    }
  }

  private sendError(client: ConnectedClient, id: string | undefined, code: string, message: string, retryable: boolean): void {
    const frame = { v: 1, t: 'error', id, code, message, retryable, ts: Date.now() };
    this.safeSend(client, JSON.stringify(frame));
  }

  private closeClient(client: ConnectedClient, code: number, reason: string): void {
    try {
      client.ws.close(code, reason);
    } catch {
      // Already closed
    }
    this.removeClient(client);
  }

  private removeClient(client: ConnectedClient): void {
    if (client.authTimer) {
      clearTimeout(client.authTimer);
    }
    this.clients.delete(client);
  }

  private safeSend(client: ConnectedClient, data: string): void {
    try {
      if (client.ws.readyState === 1) { // OPEN
        client.ws.send(data);
      }
    } catch {
      // Connection broken, will be cleaned up on close event
    }
  }
}
