/**
 * WebSocket client — connects to the Bridge, handles auth, subscribe,
 * reconnect with exponential backoff, and event dispatch.
 */

export type ConnectionState = 'disconnected' | 'connecting' | 'authenticating' | 'connected';

export interface WsClientOptions {
  url: string;
  token: string;
  onFrame: (frame: unknown) => void;
  onStateChange: (state: ConnectionState) => void;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private options: WsClientOptions;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeq = 0;
  private alive = false;
  private intentionalClose = false;

  private readonly MAX_BACKOFF_MS = 30_000;
  private readonly BASE_BACKOFF_MS = 1000;

  constructor(options: WsClientOptions) {
    this.options = options;
  }

  connect(): void {
    this.intentionalClose = false;
    this.options.onStateChange('connecting');

    try {
      this.ws = new WebSocket(this.options.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.options.onStateChange('authenticating');
      this.sendFrame({
        v: 1,
        t: 'auth',
        token: this.options.token,
        ts: Date.now(),
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data as string) as Record<string, unknown>;
        this.handleFrame(frame);
      } catch {
        // Invalid JSON, ignore
      }
    };

    this.ws.onclose = () => {
      this.alive = false;
      if (!this.intentionalClose) {
        this.options.onStateChange('disconnected');
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.alive = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.options.onStateChange('disconnected');
  }

  send(frame: unknown): void {
    if (this.ws && this.alive) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  sendFrame(frame: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  get isConnected(): boolean {
    return this.alive;
  }

  get currentLastSeq(): number {
    return this.lastSeq;
  }

  updateLastSeq(seq: number): void {
    if (seq > this.lastSeq) {
      this.lastSeq = seq;
    }
  }

  private handleFrame(frame: Record<string, unknown>): void {
    const type = frame.t as string;

    switch (type) {
      case 'hello':
        // Auth succeeded
        this.alive = true;
        this.reconnectAttempt = 0;
        this.options.onStateChange('connected');
        // Subscribe with last known seq for replay
        this.sendFrame({
          v: 1,
          t: 'subscribe',
          since: this.lastSeq,
          ts: Date.now(),
        });
        break;

      case 'heartbeat':
        // Respond with pong
        this.sendFrame({ v: 1, t: 'pong', ts: Date.now() });
        break;

      case 'event': {
        const seq = frame.seq as number;
        if (seq > this.lastSeq) {
          this.lastSeq = seq;
        }
        this.options.onFrame(frame);
        break;
      }

      case 'error':
        if (frame.code === 'AIBOU_UNAUTHORIZED') {
          // Token invalid, don't reconnect
          this.intentionalClose = true;
          this.alive = false;
          this.options.onStateChange('disconnected');
          this.ws?.close();
        }
        this.options.onFrame(frame);
        break;

      default:
        this.options.onFrame(frame);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;

    const delay = Math.min(
      this.BASE_BACKOFF_MS * Math.pow(2, this.reconnectAttempt),
      this.MAX_BACKOFF_MS,
    );
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
