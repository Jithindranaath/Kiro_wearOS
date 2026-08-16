/**
 * Approval card — shows pending permission with full tool context,
 * syntax highlighting for shell commands, and Approve/Deny controls (AC4.1.4).
 */

import { useState } from 'react';
import type { PendingApproval } from '../lib/store.js';

interface ApprovalCardProps {
  approval: PendingApproval;
  onRespond: (approvalId: string, decision: 'allow' | 'deny') => void;
}

const RISK_CONFIG: Record<string, { border: string; bg: string; label: string }> = {
  low: { border: 'border-green-700', bg: 'bg-green-900/20', label: 'Low Risk' },
  medium: { border: 'border-amber-700', bg: 'bg-amber-900/20', label: 'Medium Risk' },
  high: { border: 'border-red-700', bg: 'bg-red-900/20', label: 'High Risk' },
};

export function ApprovalCard({ approval, onRespond }: ApprovalCardProps) {
  const [responding, setResponding] = useState(false);
  const riskConfig = RISK_CONFIG[approval.riskTier] ?? RISK_CONFIG.medium;
  const toolInput = approval.toolInput as Record<string, unknown> | null;

  const timeRemaining = Math.max(0, approval.expiresAt - Date.now());
  const minutesLeft = Math.ceil(timeRemaining / 60_000);

  const handleRespond = (decision: 'allow' | 'deny') => {
    setResponding(true);
    onRespond(approval.approvalId, decision);
  };

  return (
    <div className={`border ${riskConfig.border} ${riskConfig.bg} rounded-lg p-4 space-y-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔐</span>
          <span className="text-sm font-medium text-white">{approval.toolName}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded ${riskConfig.border} border`}>
          {riskConfig.label}
        </span>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-300">{approval.summary}</p>

      {/* Full tool input */}
      {toolInput && (
        <div className="bg-gray-900 rounded p-3 overflow-x-auto">
          {toolInput.command ? (
            <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
              $ {String(toolInput.command)}
            </pre>
          ) : (
            <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap">
              {JSON.stringify(toolInput, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Timer */}
      <div className="text-xs text-gray-500">
        Expires in {minutesLeft} min{minutesLeft !== 1 ? 's' : ''}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => handleRespond('allow')}
          disabled={responding}
          className="flex-1 py-3 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 rounded-lg font-medium text-sm transition-colors"
        >
          ✓ Approve
        </button>
        <button
          onClick={() => handleRespond('deny')}
          disabled={responding}
          className="flex-1 py-3 bg-red-700 hover:bg-red-600 disabled:bg-gray-700 rounded-lg font-medium text-sm transition-colors"
        >
          ✗ Deny
        </button>
      </div>
    </div>
  );
}
