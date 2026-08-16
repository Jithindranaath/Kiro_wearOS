import { useState } from 'react';
import { pairWithBridge } from '../lib/api.js';

interface PairScreenProps {
  onPaired: (token: string, bridgeUrl: string) => void;
}

export function PairScreen({ onPaired }: PairScreenProps) {
  const [code, setCode] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState(() => {
    // Default to current origin (works when PWA is served from Bridge)
    const stored = localStorage.getItem('aibou_bridge_url');
    return stored ?? window.location.origin;
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePair = async () => {
    if (code.length !== 6) {
      setError('Enter the 6-digit code shown on the Bridge');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await pairWithBridge(bridgeUrl, code);
      localStorage.setItem('aibou_token', token);
      localStorage.setItem('aibou_bridge_url', bridgeUrl);
      onPaired(token, bridgeUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pairing failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handlePair();
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">⛩️ Aibou</h1>
          <p className="text-gray-400 mt-2">Connect to your Bridge</p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="bridge-url" className="block text-sm text-gray-400 mb-1">
              Bridge URL
            </label>
            <input
              id="bridge-url"
              type="url"
              value={bridgeUrl}
              onChange={(e) => setBridgeUrl(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="http://192.168.1.100:8787"
            />
          </div>

          <div>
            <label htmlFor="pairing-code" className="block text-sm text-gray-400 mb-1">
              6-Digit Pairing Code
            </label>
            <input
              id="pairing-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={handleKeyDown}
              className="w-full px-4 py-4 bg-gray-800 border border-gray-700 rounded-lg text-white text-center text-2xl tracking-[0.5em] font-mono placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="000000"
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handlePair}
            disabled={loading || code.length !== 6}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </div>

        <p className="text-center text-xs text-gray-500">
          Find the code in your terminal where the Bridge is running
        </p>
      </div>
    </div>
  );
}
