/**
 * Prompt input — text area for sending prompts to the agent, with interrupt control (AC4.1.5).
 */

import { useState, useRef } from 'react';

interface PromptInputProps {
  sessionId: string | null;
  sessionStatus: string;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

export function PromptInput({ sessionId, sessionStatus, onSend, onInterrupt }: PromptInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const canSend = sessionId && text.trim().length > 0;
  const isWorking = sessionStatus === 'working' || sessionStatus === 'awaiting_permission';

  const handleSend = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-gray-700 p-3 space-y-2">
      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={sessionId ? 'Send a prompt to the agent...' : 'Select a session first'}
          disabled={!sessionId}
          rows={2}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <div className="flex flex-col gap-1">
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
          >
            Send
          </button>
          {isWorking && (
            <button
              onClick={onInterrupt}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-medium transition-colors"
              title="Interrupt the agent"
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
