/**
 * Session list — shows all sessions with status, cwd basename, and pending-approval badge (AC4.1.2).
 */

import type { SessionInfo } from '../lib/store.js';

interface SessionListProps {
  sessions: Map<string, SessionInfo>;
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  /** Close a session and give its slot back. The Bridge caps how many can exist. */
  onClose: (sessionId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-gray-500',
  working: 'bg-blue-500 animate-pulse',
  awaiting_permission: 'bg-amber-500 animate-pulse',
  awaiting_input: 'bg-purple-500',
  error: 'bg-red-500',
  disconnected: 'bg-gray-700',
};

export function SessionList({ sessions, activeSessionId, onSelect, onClose }: SessionListProps) {
  if (sessions.size === 0) {
    return (
      <div className="p-4 text-gray-500 text-sm text-center">
        No active sessions.
        <br />
        Tap <span className="text-blue-400 font-medium">+ New</span> to start one.
      </div>
    );
  }

  return (
    <div className="space-y-1 p-2">
      {Array.from(sessions.values()).map((session) => {
        const cwdBasename = session.cwd.split(/[\\/]/).pop() ?? session.cwd;
        const isActive = session.id === activeSessionId;
        const statusColor = STATUS_COLORS[session.status] ?? 'bg-gray-500';

        return (
          <div
            key={session.id}
            className={`group w-full rounded-lg transition-colors ${
              isActive ? 'bg-gray-700' : 'hover:bg-gray-800'
            }`}
          >
            <div className="flex items-start">
              <button
                onClick={() => onSelect(session.id)}
                className="flex-1 text-left px-3 py-2 min-w-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} />
                    <span className="text-sm font-medium text-white truncate">
                      {cwdBasename}
                    </span>
                  </div>
                  {session.pendingApprovals > 0 && (
                    <span className="bg-amber-600 text-black text-xs font-bold px-2 py-0.5 rounded-full shrink-0">
                      {session.pendingApprovals}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-500">{session.status}</span>
                  {session.statusSource === 'inferred' && (
                    <span className="text-xs text-yellow-600 italic">inferred</span>
                  )}
                </div>
              </button>

              {/*
                Closing frees a slot against the Bridge's concurrent-session cap.
                Without it the cap is a dead end: the limit error says to close a
                session and there is no other way to do so.
              */}
              <button
                onClick={() => {
                  const label = session.pendingApprovals > 0 ? ' It has a pending approval.' : '';
                  if (window.confirm(`Close this session?${label}`)) onClose(session.id);
                }}
                title="Close session"
                aria-label={`Close session ${cwdBasename}`}
                className="px-2 py-2 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
