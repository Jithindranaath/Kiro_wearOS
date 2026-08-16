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
  ): PendingApproval {
    const approvalId = randomBytes(16).toString('hex');
    const now = Date.now();

    const summary = this.generateSummary(params);

    const approval: PendingApproval = {
      approvalId,
      acpRequestId,
      sessionId: params.sessionId,
      toolName: params.toolCall.title ?? params.toolCall.kind ?? 'unknown',
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

    // Determine the optionId to send back to ACP
    const optionId = decision === 'allow'
      ? approval.options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always')?.optionId ?? 'allow-once'
      : approval.options.find((o) => o.kind === 'reject_once' || o.kind === 'reject_always')?.optionId ?? 'reject-once';

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

    // For shell commands, show the command
    if (kind === 'shell' || kind === 'command') {
      const input = toolCall.rawInput as Record<string, unknown> | undefined;
      const command = input?.command as string | undefined;
      if (command) {
        const trimmed = command.length > 75 ? command.slice(0, 72) + '...' : command;
        return `Run: ${trimmed}`;
      }
    }

    // For file operations, show the path
    if (kind === 'write' || kind === 'edit') {
      const input = toolCall.rawInput as Record<string, unknown> | undefined;
      const path = (input?.path ?? input?.file ?? input?.targetFile) as string | undefined;
      if (path) {
        const basename = path.split(/[\\/]/).pop() ?? path;
        return `Write: ${basename}`;
      }
    }

    // For file deletion
    if (kind === 'delete') {
      const input = toolCall.rawInput as Record<string, unknown> | undefined;
      const path = (input?.path ?? input?.targetFile) as string | undefined;
      if (path) {
        const basename = path.split(/[\\/]/).pop() ?? path;
        return `Delete: ${basename}`;
      }
    }

    // Fallback: use title, truncated
    if (title) {
      return title.length > 80 ? title.slice(0, 77) + '...' : title;
    }

    return `Tool: ${kind || 'unknown'}`;
  }
}
