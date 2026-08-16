/**
 * Event stream — renders live events with auto-scroll only when at bottom (AC4.1.3).
 */

import { useRef, useEffect, useState } from 'react';
import type { SessionEvent } from '../lib/store.js';

interface EventStreamProps {
  events: SessionEvent[];
  activeSessionId: string | null;
}

const KIND_LABELS: Record<string, { icon: string; color: string }> = {
  'agent.text': { icon: '💬', color: 'text-gray-200' },
  'agent.thought': { icon: '🧠', color: 'text-purple-300' },
  'tool.start': { icon: '🔧', color: 'text-blue-300' },
  'tool.end': { icon: '✅', color: 'text-green-300' },
  'task.update': { icon: '📋', color: 'text-yellow-300' },
  'session.error': { icon: '❌', color: 'text-red-300' },
  'unknown': { icon: '❓', color: 'text-gray-500' },
};

export function EventStream({ events, activeSessionId }: EventStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const filteredEvents = activeSessionId
    ? events.filter((e) => e.sessionId === activeSessionId)
    : events;

  // Auto-scroll only when already at bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredEvents.length, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
  };

  if (filteredEvents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Waiting for agent activity...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs"
    >
      {filteredEvents.map((event, idx) => {
        const config = KIND_LABELS[event.kind] ?? KIND_LABELS['unknown'];
        const payload = event.payload as Record<string, unknown>;

        return (
          <div key={`${event.seq}-${idx}`} className={`flex gap-2 ${config.color}`}>
            <span className="flex-shrink-0">{config.icon}</span>
            <span className="flex-shrink-0 text-gray-600 w-8">{event.seq}</span>
            <span className="break-all">
              {renderPayload(event.kind, payload)}
            </span>
          </div>
        );
      })}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (containerRef.current) {
              containerRef.current.scrollTop = containerRef.current.scrollHeight;
            }
          }}
          className="sticky bottom-2 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs px-3 py-1 rounded-full"
        >
          ↓ Scroll to bottom
        </button>
      )}
    </div>
  );
}

function renderPayload(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'agent.text':
      if (payload.turnEnd) return '— turn ended —';
      return String(payload.text ?? '');
    case 'tool.start':
      return `${payload.title ?? payload.kind ?? 'tool'} [${payload.status}]`;
    case 'tool.end':
      return `completed (${payload.toolCallId})`;
    case 'session.error':
      return String(payload.message ?? payload.error ?? JSON.stringify(payload));
    default:
      return JSON.stringify(payload).slice(0, 200);
  }
}
