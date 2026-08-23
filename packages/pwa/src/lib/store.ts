/**
 * Application state store — manages sessions, events, approvals, and connection state.
 * Uses React's useReducer pattern for predictable state transitions.
 */

export interface SessionInfo {
  id: string;
  cwd: string;
  status: string;
  statusSource: 'observed' | 'inferred';
  statusReason?: string;
  pendingApprovals: number;
  lastActivity: number;
}

export interface SessionEvent {
  sessionId: string;
  seq: number;
  kind: string;
  payload: unknown;
  ts: number;
}

export interface PendingApproval {
  approvalId: string;
  sessionId: string;
  toolName: string;
  summary: string;
  toolInput: unknown;
  riskTier: 'low' | 'medium' | 'high';
  expiresAt: number;
}

/**
 * The Kiro account the agent runs as, exactly as the Bridge reported it.
 *
 * Distinct from this browser's pairing token: signing out of Kiro does not
 * unpair the device, and unpairing does not sign the account out.
 */
export interface AccountInfo {
  state: 'authenticated' | 'unauthenticated' | 'authenticating' | 'mock' | 'unavailable';
  accountType?: string;
  provider?: string;
  email?: string;
  verificationUri?: string;
  userCode?: string;
  reason?: string;
}

export interface AppState {
  connectionState: 'disconnected' | 'connecting' | 'authenticating' | 'connected';
  mode: 'live' | 'mock' | null;
  account: AccountInfo | null;
  sessions: Map<string, SessionInfo>;
  events: SessionEvent[];
  pendingApprovals: Map<string, PendingApproval>;
  error: string | null;
}

export type AppAction =
  | { type: 'SET_CONNECTION_STATE'; state: AppState['connectionState'] }
  | { type: 'SET_MODE'; mode: 'live' | 'mock' }
  | { type: 'ACCOUNT_STATE'; account: AccountInfo }
  | { type: 'SESSION_STATE'; session: SessionInfo }
  | { type: 'SESSION_CLOSED'; sessionId: string }
  | { type: 'EVENT'; event: SessionEvent }
  | { type: 'PERMISSION_REQUEST'; approval: PendingApproval }
  | { type: 'PERMISSION_RESOLVED'; approvalId: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'RESET' };

export const initialState: AppState = {
  connectionState: 'disconnected',
  mode: null,
  account: null,
  sessions: new Map(),
  events: [],
  pendingApprovals: new Map(),
  error: null,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CONNECTION_STATE':
      return { ...state, connectionState: action.state };

    case 'SET_MODE':
      return { ...state, mode: action.mode };

    case 'ACCOUNT_STATE':
      return { ...state, account: action.account };

    case 'SESSION_STATE': {
      const sessions = new Map(state.sessions);
      sessions.set(action.session.id, action.session);
      return { ...state, sessions };
    }

    case 'SESSION_CLOSED': {
      const sessions = new Map(state.sessions);
      sessions.delete(action.sessionId);

      // Drop its approvals too: a pending approval for a closed session can no
      // longer be answered, and leaving the card up would invite a dead tap.
      const pendingApprovals = new Map(state.pendingApprovals);
      for (const [id, approval] of pendingApprovals) {
        if (approval.sessionId === action.sessionId) pendingApprovals.delete(id);
      }

      return { ...state, sessions, pendingApprovals };
    }

    case 'EVENT': {
      // Keep last 500 events per display, auto-trim
      const events = [...state.events, action.event];
      if (events.length > 500) {
        return { ...state, events: events.slice(-500) };
      }
      return { ...state, events };
    }

    case 'PERMISSION_REQUEST': {
      const pendingApprovals = new Map(state.pendingApprovals);
      pendingApprovals.set(action.approval.approvalId, action.approval);
      return { ...state, pendingApprovals };
    }

    case 'PERMISSION_RESOLVED': {
      const pendingApprovals = new Map(state.pendingApprovals);
      pendingApprovals.delete(action.approvalId);
      return { ...state, pendingApprovals };
    }

    case 'SET_ERROR':
      return { ...state, error: action.error };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    case 'RESET':
      return { ...initialState };

    default:
      return state;
  }
}
