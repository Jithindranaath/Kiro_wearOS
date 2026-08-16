/**
 * New session dialog — lets the user create an ACP session by entering a
 * working directory. Without this, a freshly paired client has no way to
 * start a session and the UI is a dead end.
 */

import { useState } from 'react';

interface NewSessionDialogProps {
  open: boolean;
  creating: boolean;
  error: string | null;
  onCreate: (cwd: string) => void;
  onClose: () => void;
}

export function NewSessionDialog({ open, creating, error, onCreate, onClose }: NewSessionDialogProps) {
  const [cwd, setCwd] = useState('');

  if (!open) return null;

  const submit = () => {
    const trimmed = cwd.trim();
    if (trimmed.length === 0 || creating) return;
    onCreate(trimmed);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-5 w-full max-w-md space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">New Session</h2>
          <p className="text-sm text-gray-400 mt-1">
            Absolute path to the project directory on the machine running the Bridge.
          </p>
        </div>

        <input
          type="text"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="C:\\Users\\you\\projects\\my-app"
          spellCheck={false}
          autoFocus
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={submit}
            disabled={creating || cwd.trim().length === 0}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
          <button
            onClick={onClose}
            disabled={creating}
            className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
