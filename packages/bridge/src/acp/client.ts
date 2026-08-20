/**
 * ACP Client — JSON-RPC 2.0 over stdin/stdout.
 *
 * Spawns kiro-cli acp as a child process and communicates via JSON-RPC.
 * Handles request/response correlation, notifications, and incoming requests
 * (like session/request_permission) from the agent.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { AibouError, AibouErrorCode, ExitCode } from '@aibou/protocol';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  method: string;
  timestamp: number;
}

export interface AcpClientOptions {
  kiroBin: string;
  args: string[];
  trace: boolean;
  traceLog?: (direction: 'in' | 'out', frame: unknown) => void;
}

export interface AcpClientEvents {
  notification: (method: string, params: unknown) => void;
  request: (id: number | string, method: string, params: unknown) => void;
  error: (error: Error) => void;
  exit: (code: number | null, signal: string | null) => void;
  ready: () => void;
}

export class AcpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private readonly options: AcpClientOptions;
  private alive = false;

  constructor(options: AcpClientOptions) {
    super();
    this.options = options;
  }

  /**
   * Spawn the kiro-cli acp process and start reading JSON-RPC frames.
   */
  spawn(): void {
    const { kiroBin, args, trace } = this.options;

    this.process = spawn(kiroBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new AibouError(
        AibouErrorCode.AGENT_DOWN,
        `Failed to spawn ACP agent: stdio not available`,
      );
    }

    this.alive = true;

    // Read stdout line by line (JSON-RPC frames are newline-delimited)
    this.readline = createInterface({ input: this.process.stdout });
    this.readline.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        if (trace && this.options.traceLog) {
          this.options.traceLog('in', msg);
        }
        this.handleMessage(msg);
      } catch (err) {
        this.emit('error', new Error(`Failed to parse ACP frame: ${line}`));
      }
    });

    // Capture stderr for logging
    if (this.process.stderr) {
      const stderrRl = createInterface({ input: this.process.stderr });
      stderrRl.on('line', (line) => {
        if (trace) {
          console.error(`[acp-agent stderr] ${line}`);
        }
      });
    }

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.alive = false;
      this.failAllPending(
        `Agent exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`,
      );
      this.emit('exit', code, signal);
    });

    // A spawn failure (e.g. ENOENT) emits 'error' and may never emit 'exit'.
    // Pending requests must still be rejected, otherwise callers await a
    // promise that never settles and the process exits silently with code 0.
    this.process.on('error', (err) => {
      this.alive = false;
      const wrapped = new AibouError(
        AibouErrorCode.AGENT_DOWN,
        `Failed to spawn ACP agent at "${kiroBin}": ${err.message}. ` +
          `Set AIBOU_KIRO_BIN to the correct path.`,
      );
      this.failAllPending(wrapped.message);
      this.emit('error', wrapped);
      this.emit('spawnFailed', wrapped);
    });

    this.emit('ready');
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   *
   * @param timeoutMs Reject if the agent does not reply in time. Omit (or pass
   *   0) for calls that legitimately stay open for the whole turn, such as
   *   `session/prompt`.
   */
  async request(method: string, params?: unknown, timeoutMs = 0): Promise<unknown> {
    if (!this.alive || !this.process?.stdin) {
      throw new AibouError(AibouErrorCode.AGENT_DOWN, 'ACP agent is not running');
    }

    const id = this.nextId++;
    const frame: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const settle = {
        resolve: (value: unknown) => {
          if (timer) clearTimeout(timer);
          resolve(value);
        },
        reject: (err: Error) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
        method,
        timestamp: Date.now(),
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(
            new AibouError(
              AibouErrorCode.AGENT_DOWN,
              `Agent did not respond to ${method} within ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }

      this.pending.set(id, settle);
      this.sendFrame(frame);
    });
  }

  /** Reject every in-flight request with the same cause. */
  private failAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      pending.reject(
        new AibouError(
          AibouErrorCode.AGENT_DOWN,
          `${reason} while waiting for response to ${pending.method} (id: ${id})`,
        ),
      );
    }
    this.pending.clear();
  }

  /**
   * Send a JSON-RPC response (answering an incoming request from the agent).
   */
  respond(id: number | string, result: unknown): void {
    const frame: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };
    this.sendFrame(frame);
  }

  /**
   * Send a JSON-RPC error response.
   */
  respondError(id: number | string, code: number, message: string): void {
    const frame = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
    this.sendFrame(frame);
  }

  /**
   * Send a notification to the agent (no response expected).
   */
  notify(method: string, params?: unknown): void {
    const frame: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.sendFrame(frame);
  }

  /**
   * Kill the agent process.
   */
  kill(): void {
    if (this.process && this.alive) {
      this.process.kill();
      this.alive = false;
    }
  }

  get isAlive(): boolean {
    return this.alive;
  }

  private sendFrame(frame: unknown): void {
    if (!this.process?.stdin?.writable) return;
    const data = JSON.stringify(frame) + '\n';
    if (this.options.trace && this.options.traceLog) {
      this.options.traceLog('out', frame);
    }
    this.process.stdin.write(data);
  }

  private handleMessage(msg: JsonRpcMessage): void {
    // Response to one of our requests
    if ('id' in msg && ('result' in msg || 'error' in msg) && !('method' in msg)) {
      const response = msg as JsonRpcResponse;
      const pending = this.pending.get(response.id);
      if (pending) {
        this.pending.delete(response.id);
        if (response.error) {
          pending.reject(
            new AibouError(
              AibouErrorCode.INTERNAL,
              `ACP error on ${pending.method}: ${response.error.message} (code: ${response.error.code})`,
            ),
          );
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Incoming request from agent (e.g., session/request_permission)
    if ('id' in msg && 'method' in msg) {
      const request = msg as JsonRpcRequest;
      this.emit('request', request.id, request.method, request.params);
      return;
    }

    // Notification from agent (e.g., session/update)
    if ('method' in msg && !('id' in msg)) {
      const notification = msg as JsonRpcNotification;
      this.emit('notification', notification.method, notification.params);
      return;
    }
  }
}
