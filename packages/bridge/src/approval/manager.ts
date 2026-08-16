/**
 * Approval Manager — holds ACP permission requests, manages resolution.
 *
 * When the ACP agent sends session/request_permission, we hold the response
 * open until a client approves/denies or the timeout fires.
 *
 * Invariants (architecture.md §6):
 * 1. Exactly one ACP answer per request, ever.
 * 2. A held request always terminates: user response or timeout → deny.
 * 3. Client disconnection never resolves an approval.
 * 4. Every resolution emits permission.resolved.
 */

import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { RiskTier } from '@aibou/protocol';
import type { PermissionRequestParams } from '../acp/methods.js';

export interface PendingApproval {
  approvalId: string;
  acpRequestId: number | string;
  sessionId: string;
  toolName: string;
  summary: string;
  toolInput: unknown;
  riskTier: RiskTier;
  options: PermissionRequestParams['options'];
  createdAt: number;
  expiresAt: number;
  resolved: boolean;
}

export interface ApprovalResolution {
  approvalId: string;
  decision: 'allow' | 'deny';
  resolution: 'user' | 'policy' | 'timeout';
  resolvedBy?: string;
  ruleId?: string;
}

const DEFAULT_TIMEOUT_MS = 900_000; // 15 minutes

/** Max characters for a watch-safe summary (AC2.1.2). */
const SUMMARY_MAX_LEN = 80;

/** Collapse newlines/tabs so a multi-line command stays single-line on a watch. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Truncate to the watch budget without splitting a surrogate pair. */
function truncate(value: string): string {
  if (value.length <= SUMMARY_MAX_LEN) return value;
  let cut = SUMMARY_MAX_LEN - 1;
  const code = value.charCodeAt(cut - 1);
  // Avoid slicing between a high and low surrogate.
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return value.slice(0, cut) + '…';
}

function basename(pathLike: string): string {
  const parts = pathLike.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : pathLike;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export class ApprovalManager extends EventEmitter {
  private pending = new Map<string, PendingApproval>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private timeoutMs: number;

  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    super();
    this.timeoutMs = timeoutMs;
  }

  /**
   * Create a pending approval from an ACP permission request.
   * Returns the approval record for broadcasting.
   */
  createApproval(
    acpRequestId: number | string,
    params: PermissionRequestParams,
    riskTier: RiskTier,
    /** Resolved tool identifier (Kiro tool name or ACP kind) for display. */
    toolName?: string,
  ): PendingApproval {
    const approvalId = randomBytes(16).toString('hex');
    const now = Date.now();

    const summary = this.generateSummary(params);

    const approval: PendingApproval = {
      approvalId,
      acpRequestId,
      sessionId: params.sessionId,
      toolName: toolName ?? params.toolCall.kind ?? params.toolCall.title ?? 'unknown',
      summary,
      toolInput: params.toolCall.rawInput,
      riskTier,
      options: params.options,
      createdAt: now,
      expiresAt: now + this.timeoutMs,
      resolved: false,
    };

    this.pending.set(approvalId, approval);

    // Set timeout → auto-deny (AC2.1.5)
    const timer = setTimeout(() => {
      this.resolveApproval(approvalId, 'deny', 'timeout');
    }, this.timeoutMs);
    this.timers.set(approvalId, timer);

    return approval;
  }

  /**
   * Resolve an approval with a decision.
   * Returns the ACP request ID so the caller can respond to the agent.
   * Returns null if already resolved (AC2.1.4).
   */
  resolveApproval(
    approvalId: string,
    decision: 'allow' | 'deny',
    resolution: 'user' | 'policy' | 'timeout',
    resolvedBy?: string,
    ruleId?: string,
  ): { acpRequestId: number | string; optionId: string } | null {
    const approval = this.pending.get(approvalId);
    if (!approval || approval.resolved) {
      return null; // Already resolved — AC2.1.4
    }

    // Mark as resolved
    approval.resolved = true;

    // Clear timeout
    const timer = this.timers.get(approvalId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(approvalId);
    }

    // Resolve the agent-defined option id via the semantic `kind` field.
    // Real kiro-cli uses snake_case ids (allow_once / reject_once), so never
    // assume a hyphenated literal.
    const preferredKinds =
      decision === 'allow'
        ? (['allow_once', 'allow_always'] as const)
        : (['reject_once', 'reject_always'] as const);

    let optionId: string | undefined;
    for (const kind of preferredKinds) {
      const match = approval.options.find((o) => o.kind === kind);
      if (match) {
        optionId = match.optionId;
        break;
      }
    }
    optionId ??= decision === 'allow' ? 'allow_once' : 'reject_once';

    // Emit resolution event
    const resolutionEvent: ApprovalResolution = {
      approvalId,
      decision,
      resolution,
      resolvedBy,
      ruleId,
    };
    this.emit('resolved', resolutionEvent, approval.sessionId);

    // Remove from pending after a short delay (allow clients to receive the resolution)
    setTimeout(() => {
      this.pending.delete(approvalId);
    }, 5000);

    return { acpRequestId: approval.acpRequestId, optionId };
  }

  /**
   * Get all pending (unresolved) approvals.
   */
  getPending(): PendingApproval[] {
    return Array.from(this.pending.values()).filter((a) => !a.resolved);
  }

  /**
   * Get pending approvals for a specific session.
   */
  getPendingForSession(sessionId: string): PendingApproval[] {
    return this.getPending().filter((a) => a.sessionId === sessionId);
  }

  /**
   * Get a specific pending approval by ID.
   */
  getApproval(approvalId: string): PendingApproval | undefined {
    return this.pending.get(approvalId);
  }

  /**
   * Cancel all pending approvals for a session (e.g., on session interrupt).
   */
  cancelAllForSession(sessionId: string): void {
    for (const [approvalId, approval] of this.pending) {
      if (approval.sessionId === sessionId && !approval.resolved) {
        this.resolveApproval(approvalId, 'deny', 'timeout');
      }
    }
  }

  /**
   * Generate a summary string ≤80 chars for watch display.
   */
  private generateSummary(params: PermissionRequestParams): string {
    const { toolCall } = params;
    const title = toolCall.title ?? '';
    const kind = toolCall.kind ?? '';
    const input = (toolCall.rawInput ?? undefined) as Record<string, unknown> | undefined;

    const firstString = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = input?.[key];
        if (typeof value === 'string' && value.length > 0) return value;
      }
      return undefined;
    };

    // Command execution. Real kiro-cli reports kind "execute".
    const command = firstString('command', 'cmd');
    if (command && (kind === 'execute' || kind === 'shell' || kind === 'command' || kind === '')) {
      return truncate(`Run: ${collapseWhitespace(command)}`);
    }

    // File writes / edits
    if (kind === 'write' || kind === 'edit') {
      const path = firstString('path', 'file', 'targetFile', 'filePath', 'file_path');
      if (path) return truncate(`Write: ${basename(path)}`);
    }

    // File deletion
    if (kind === 'delete') {
      const path = firstString('path', 'targetFile', 'filePath', 'file_path');
      if (path) return truncate(`Delete: ${basename(path)}`);
    }

    // Reads / fetches
    if (kind === 'read' || kind === 'fetch' || kind === 'search') {
      const target = firstString('path', 'file', 'url', 'query', 'pattern');
      if (target) return truncate(`${capitalize(kind)}: ${basename(target)}`);
    }

    // Fall back to the agent's own title, which is always human readable.
    if (title) return truncate(collapseWhitespace(title));

    // Last resort: a generic label. Never fabricate specifics.
    return truncate(kind ? `Tool: ${kind}` : 'Approval required');
  }
}
