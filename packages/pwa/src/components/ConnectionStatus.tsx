/**
 * Connection state indicator — shows reconnecting state rather than silently failing (AC4.1.6).
 */

import type { ConnectionState } from '../lib/ws.js';

interface ConnectionStatusProps {
  state: ConnectionState;
}

const STATUS_CONFIG: Record<ConnectionState, { label: string; color: string; pulse: boolean }> = {
  connected: { label: 'Connected', color: 'bg-green-500', pulse: false },
  connecting: { label: 'Connecting...', color: 'bg-yellow-500', pulse: true },
  authenticating: { label: 'Authenticating...', color: 'bg-yellow-500', pulse: true },
  disconnected: { label: 'Disconnected', color: 'bg-red-500', pulse: false },
};

export function ConnectionStatus({ state }: ConnectionStatusProps) {
  const config = STATUS_CONFIG[state];

  return (
    <div className="flex items-center gap-2 text-sm">
      <div className={`w-2 h-2 rounded-full ${config.color} ${config.pulse ? 'animate-pulse' : ''}`} />
      <span className="text-gray-400">{config.label}</span>
    </div>
  );
}
