import { useReducer, useCallback, useEffect, useRef, useState } from 'react';
import { WsClient, type ConnectionState } from './lib/ws.js';
import { appReducer, initialState, type AccountInfo, type PendingApproval, type SessionEvent, type SessionInfo } from './lib/store.js';
import { PairScreen } from './components/PairScreen.js';
import { MockBanner } from './components/MockBanner.js';
import { AccountPanel } from './components/AccountPanel.js';
import { ConnectionStatus } from './components/ConnectionStatus.js';
import { SessionList } from './components/SessionList.js';
import { EventStream } from './components/EventStream.js';
import { ApprovalCard } from './components/ApprovalCard.js';
import { PromptInput } from './components/PromptInput.js';
import { NewSessionDialog } from './components/NewSessionDialog.js';

/** Correlation id used for the session.create request/response pair. */
const CREATE_SESSION_FRAME_ID = 'pwa-session-create';

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const wsRef = useRef<WsClient | null>(null);

  // Check if already paired
  const [paired, setPaired] = useState(() => {
    return !!(localStorage.getItem('aibou_token') && localStorage.getItem('aibou_bridge_url'));
  });
  /** Why pairing was lost, so the pairing screen can explain itself. */
  const [unpairedReason, setUnpairedReason] = useState<string | null>(null);

  const handleFrame = useCallback((frame: unknown) => {
    const f = frame as Record<string, unknown>;
    switch (f.t) {
      case 'hello':
        dispatch({ type: 'SET_MODE', mode: f.mode as 'live' | 'mock' });
        break;

      case 'session.state': {
        const session: SessionInfo = {
          id: f.sessionId as string,
          cwd: f.cwd as string,
          status: f.status as string,
          statusSource: f.statusSource as 'observed' | 'inferred',
          statusReason: f.statusReason as string | undefined,
          pendingApprovals: f.pendingApprovals as number,
          lastActivity: f.lastActivity as number,
        };
        dispatch({ type: 'SESSION_STATE', session });
        // Auto-select first session
        if (!activeSessionId) {
          setActiveSessionId(session.id);
        }
        break;
      }

      case 'event': {
        const event: SessionEvent = {
          sessionId: f.sessionId as string,
          seq: f.seq as number,
          kind: f.kind as string,
          payload: f.payload,
          ts: f.ts as number,
        };
        dispatch({ type: 'EVENT', event });
        wsRef.current?.updateLastSeq(event.seq);
        break;
      }

      case 'permission.request': {
        const approval: PendingApproval = {
          approvalId: f.approvalId as string,
          sessionId: f.sessionId as string,
          toolName: f.toolName as string,
          summary: f.summary as string,
          toolInput: f.toolInput,
          riskTier: f.riskTier as 'low' | 'medium' | 'high',
          expiresAt: f.expiresAt as number,
        };
        dispatch({ type: 'PERMISSION_REQUEST', approval });
        // Raise browser notification if permitted
        notifyPermissionRequest(approval);
        break;
      }

      case 'permission.resolved':
        dispatch({ type: 'PERMISSION_RESOLVED', approvalId: f.approvalId as string });
        break;

      case 'account.state': {
        // Copy only the fields the Bridge sent; an absent email must stay absent.
        const account: AccountInfo = {
          state: f.state as AccountInfo['state'],
          accountType: f.accountType as string | undefined,
          provider: f.provider as string | undefined,
          email: f.email as string | undefined,
          verificationUri: f.verificationUri as string | undefined,
          userCode: f.userCode as string | undefined,
          reason: f.reason as string | undefined,
        };
        dispatch({ type: 'ACCOUNT_STATE', account });
        break;
      }

      case 'ack':
        // Session creation succeeded — close the dialog and select the new session
        if (f.id === CREATE_SESSION_FRAME_ID) {
          setCreating(false);
          setCreateError(null);
          setDialogOpen(false);
          const created = f.result as { id?: string } | undefined;
          if (created?.id) {
            setActiveSessionId(created.id);
          }
        }
        break;

      case 'error':
        // A rejected token is terminal: the ws client stops reconnecting, so
        // without this the page sits on "Disconnected" forever with no reason
        // given and no way forward. Send the developer back to pairing instead.
        if (f.code === 'AIBOU_UNAUTHORIZED') {
          localStorage.removeItem('aibou_token');
          localStorage.removeItem('aibou_bridge_url');
          setUnpairedReason('This device is no longer paired with the Bridge. Pair again to continue.');
          setPaired(false);
          dispatch({ type: 'RESET' });
          break;
        }
        // Route session-creation errors to the dialog, everything else to the toast
        if (f.id === CREATE_SESSION_FRAME_ID) {
          setCreating(false);
          setCreateError(f.message as string);
        } else {
          dispatch({ type: 'SET_ERROR', error: f.message as string });
        }
        break;
    }
  }, [activeSessionId]);

  const handleStateChange = useCallback((connState: ConnectionState) => {
    dispatch({ type: 'SET_CONNECTION_STATE', state: connState });
  }, []);

  const connectWs = useCallback((token: string, bridgeUrl: string) => {
    const wsUrl = bridgeUrl.replace(/^http/, 'ws') + '/ws';
    const client = new WsClient({
      url: wsUrl,
      token,
      onFrame: handleFrame,
      onStateChange: handleStateChange,
    });
    wsRef.current = client;
    client.connect();
  }, [handleFrame, handleStateChange]);

  // Auto-connect if already paired
  useEffect(() => {
    if (paired) {
      const token = localStorage.getItem('aibou_token')!;
      const bridgeUrl = localStorage.getItem('aibou_bridge_url')!;
      connectWs(token, bridgeUrl);
    }
    return () => {
      wsRef.current?.disconnect();
    };
  }, [paired, connectWs]);

  const handlePaired = (token: string, bridgeUrl: string) => {
    setUnpairedReason(null);
    setPaired(true);
    connectWs(token, bridgeUrl);
  };

  /** Reconnect now rather than waiting out the exponential backoff. */
  const handleRetry = () => {
    const token = localStorage.getItem('aibou_token');
    const bridgeUrl = localStorage.getItem('aibou_bridge_url');
    if (!token || !bridgeUrl) return;
    wsRef.current?.disconnect();
    connectWs(token, bridgeUrl);
  };

  const handleUnpair = () => {
    wsRef.current?.disconnect();
    localStorage.removeItem('aibou_token');
    localStorage.removeItem('aibou_bridge_url');
    setPaired(false);
    dispatch({ type: 'RESET' });
  };

  const handlePermissionRespond = (approvalId: string, decision: 'allow' | 'deny') => {
    wsRef.current?.send({
      v: 1,
      t: 'permission.respond',
      approvalId,
      decision,
      ts: Date.now(),
    });
  };

  const handlePromptSend = (text: string) => {
    if (!activeSessionId) return;
    wsRef.current?.send({
      v: 1,
      t: 'prompt.send',
      sessionId: activeSessionId,
      text,
      source: 'text',
      ts: Date.now(),
    });
  };

  const handleInterrupt = () => {
    if (!activeSessionId) return;
    wsRef.current?.send({
      v: 1,
      t: 'session.interrupt',
      sessionId: activeSessionId,
      ts: Date.now(),
    });
  };

  const handleAccountLogin = (social?: 'google' | 'github') => {
    wsRef.current?.send({
      v: 1,
      t: 'account.login',
      // Social sign-in implies a Builder ID (free) licence; omitting `social`
      // lets the CLI ask, which covers Identity Center setups.
      ...(social ? { social, license: 'free' } : {}),
      ts: Date.now(),
    });
  };

  const handleAccountCancelLogin = () => {
    wsRef.current?.send({ v: 1, t: 'account.login.cancel', ts: Date.now() });
  };

  const handleAccountLogout = () => {
    // Signing out stops the agent working, so make that explicit rather than
    // letting a stray click end the session.
    const ok = window.confirm(
      'Sign out of Kiro?\n\nThe agent cannot run until you sign in again. Your paired devices stay paired.',
    );
    if (!ok) return;
    wsRef.current?.send({ v: 1, t: 'account.logout', ts: Date.now() });
  };

  const handleCloseSession = (sessionId: string) => {
    wsRef.current?.send({ v: 1, t: 'session.close', sessionId, ts: Date.now() });
    // Drop it locally too: the Bridge stops broadcasting for a removed session,
    // so waiting for an update would leave a dead row in the list.
    dispatch({ type: 'SESSION_CLOSED', sessionId });
    if (activeSessionId === sessionId) setActiveSessionId(null);
  };

  const handleCreateSession = (cwd: string) => {
    setCreating(true);
    setCreateError(null);
    wsRef.current?.send({
      v: 1,
      t: 'session.create',
      id: CREATE_SESSION_FRAME_ID,
      cwd,
      ts: Date.now(),
    });
  };

  // Show pairing screen if not connected
  if (!paired) {
    return <PairScreen onPaired={handlePaired} reason={unpairedReason} />;
  }

  const activeSession = activeSessionId ? state.sessions.get(activeSessionId) : undefined;
  const pendingApprovals = Array.from(state.pendingApprovals.values());

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <MockBanner visible={state.mode === 'mock'} />

      {/* Header */}
      <header className="border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">⛩️ Aibou</h1>
          <ConnectionStatus state={state.connectionState} onRetry={handleRetry} />
        </div>
        <button
          onClick={handleUnpair}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Disconnect
        </button>
      </header>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar — Session list */}
        <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-gray-700 overflow-y-auto">
          <div className="p-3 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sessions</h2>
            <button
              onClick={() => {
                setCreateError(null);
                setDialogOpen(true);
              }}
              disabled={state.connectionState !== 'connected'}
              className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded transition-colors"
              title="Create a new session"
            >
              + New
            </button>
          </div>
          <SessionList
            sessions={state.sessions}
            activeSessionId={activeSessionId}
            onSelect={setActiveSessionId}
            onClose={handleCloseSession}
          />
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Kiro account — who the agent runs as */}
          <div className="border-b border-gray-700 p-3">
            <AccountPanel
              account={state.account}
              connected={state.connectionState === 'connected'}
              onLogin={handleAccountLogin}
              onCancelLogin={handleAccountCancelLogin}
              onLogout={handleAccountLogout}
            />
          </div>

          {/* Pending approvals */}
          {pendingApprovals.length > 0 && (
            <div className="border-b border-gray-700 p-3 space-y-3 max-h-80 overflow-y-auto">
              <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
                ⚡ Pending Approvals ({pendingApprovals.length})
              </h3>
              {pendingApprovals.map((approval) => (
                <ApprovalCard
                  key={approval.approvalId}
                  approval={approval}
                  onRespond={handlePermissionRespond}
                />
              ))}
            </div>
          )}

          {/* Event stream */}
          <EventStream events={state.events} activeSessionId={activeSessionId} />

          {/* Prompt input */}
          <PromptInput
            sessionId={activeSessionId}
            sessionStatus={activeSession?.status ?? 'idle'}
            onSend={handlePromptSend}
            onInterrupt={handleInterrupt}
          />
        </main>
      </div>

      <NewSessionDialog
        open={dialogOpen}
        creating={creating}
        error={createError}
        onCreate={handleCreateSession}
        onClose={() => setDialogOpen(false)}
      />

      {/* Error toast */}
      {state.error && (
        <div className="fixed bottom-4 right-4 bg-red-900 border border-red-700 rounded-lg p-4 max-w-sm shadow-lg">
          <div className="flex items-start gap-2">
            <span className="text-red-400">⚠️</span>
            <div className="flex-1">
              <p className="text-sm text-red-200">{state.error}</p>
            </div>
            <button
              onClick={() => dispatch({ type: 'CLEAR_ERROR' })}
              className="text-red-400 hover:text-red-200"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Raise a browser notification for permission escalation (AC4.2.2).
 */
function notifyPermissionRequest(approval: PendingApproval): void {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') {
    Notification.requestPermission();
    return;
  }

  new Notification('⛩️ Aibou — Approval Needed', {
    body: approval.summary,
    tag: approval.approvalId,
    requireInteraction: true,
  });
}
