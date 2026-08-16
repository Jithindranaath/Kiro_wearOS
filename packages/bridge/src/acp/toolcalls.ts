/**
 * Tool call registry.
 *
 * Real kiro-cli sends `session/request_permission` with a minimal `toolCall`
 * containing only `toolCallId` and `title`. The command, input payload, tool
 * kind and Kiro tool name arrive earlier, in the `session/update: tool_call`
 * notification that shares the same `toolCallId`.
 *
 * Verified against kiro-cli 2.18.1 — see docs/acp-findings.md.
 *
 * This registry remembers those details so the policy engine can evaluate the
 * real command and the clients can display real input instead of `undefined`.
 */

export interface ToolCallDetails {
  toolCallId: string;
  sessionId: string;
  /** Human readable title, e.g. "Running: node --version". */
  title?: string;
  /** ACP tool kind, e.g. "execute", "read", "edit". */
  kind?: string;
  /** Raw tool input, e.g. { command: "node --version" }. */
  rawInput?: unknown;
  /** Kiro-specific tool name from `_meta.kiro.toolName`, e.g. "shell". */
  kiroToolName?: string;
  seenAt: number;
}

const DEFAULT_CAPACITY = 200;

export class ToolCallRegistry {
  private byId = new Map<string, ToolCallDetails>();
  private readonly capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  /**
   * Record (or merge into) the details for a tool call.
   * Later updates only overwrite fields that are actually present.
   */
  record(sessionId: string, update: Record<string, unknown>): void {
    const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : undefined;
    if (!toolCallId) return;

    const existing = this.byId.get(toolCallId);

    const details: ToolCallDetails = {
      toolCallId,
      sessionId,
      title: typeof update.title === 'string' ? update.title : existing?.title,
      kind: typeof update.kind === 'string' ? update.kind : existing?.kind,
      rawInput: update.rawInput !== undefined ? update.rawInput : existing?.rawInput,
      kiroToolName: extractKiroToolName(update) ?? existing?.kiroToolName,
      seenAt: Date.now(),
    };

    this.byId.set(toolCallId, details);
    this.evictIfNeeded();
  }

  /** Look up remembered details for a tool call id. */
  get(toolCallId: string | undefined): ToolCallDetails | undefined {
    if (!toolCallId) return undefined;
    return this.byId.get(toolCallId);
  }

  /** Drop everything belonging to a session (session ended or disconnected). */
  clearSession(sessionId: string): void {
    for (const [id, details] of this.byId) {
      if (details.sessionId === sessionId) {
        this.byId.delete(id);
      }
    }
  }

  get size(): number {
    return this.byId.size;
  }

  /** Evict oldest entries so a long session cannot grow memory unbounded. */
  private evictIfNeeded(): void {
    if (this.byId.size <= this.capacity) return;
    const sorted = [...this.byId.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt);
    const excess = this.byId.size - this.capacity;
    for (let i = 0; i < excess; i++) {
      this.byId.delete(sorted[i][0]);
    }
  }
}

/**
 * Read `_meta.kiro.toolName` if present. Kiro exposes the underlying tool name
 * (e.g. "shell", "fs_write") here, which is what policy rules should match on.
 */
function extractKiroToolName(update: Record<string, unknown>): string | undefined {
  const meta = update._meta;
  if (!meta || typeof meta !== 'object') return undefined;
  const kiro = (meta as Record<string, unknown>).kiro;
  if (!kiro || typeof kiro !== 'object') return undefined;
  const toolName = (kiro as Record<string, unknown>).toolName;
  return typeof toolName === 'string' ? toolName : undefined;
}
