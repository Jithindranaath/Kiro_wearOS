/**
 * Connection state indicator — shows reconnecting state rather than silently failing (AC4.1.6).
 */

import type { ConnectionState } from '../lib/ws.js';

interface ConnectionStatusProps {
  state: ConnectionState;
  /** Retry immediately instead of waiting out the backoff. */
  onRetry?: () => void;
}

const STATUS_CONFIG: Record<ConnectionState, { label: string; color: string; pulse: boolean }> = {
  connected: { label: 'Connected', color: 'bg-green-500', pulse: false },
  connecting: { label: 'Connecting...', color: 'bg-yellow-500', pulse: true },
  authenticating: { label: 'Authenticating...', color: 'bg-yellow-500', pulse: true },
  disconnected: { label: 'Disconnected', color: 'bg-red-500', pulse: false },
};

export function ConnectionStatus({ state, onRetry }: ConnectionStatusProps) {
  const config = STATUS_CONFIG[state];

  return (
    <div className="flex items-center gap-2 text-sm">
      <div className={`w-2 h-2 rounded-full ${config.color} ${config.pulse ? 'animate-pulse' : ''}`} />
      <span className="text-gray-400">{config.label}</span>

      {/*
        Reconnect backs off up to 30s, so a tab that lost the Bridge can sit
        looking dead for a while with nothing to do about it. This gives the
        developer a way to stop waiting.
      */}
      {state === 'disconnected' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs text-blue-400 hover:text-blue-300 underline"
        >
          retry now
        </button>
      )}
    </div>
  );
}
