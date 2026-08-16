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

export interface AppState {
  connectionState: 'disconnected' | 'connecting' | 'authenticating' | 'connected';
  mode: 'live' | 'mock' | null;
  sessions: Map<string, SessionInfo>;
  events: SessionEvent[];
  pendingApprovals: Map<string, PendingApproval>;
  error: string | null;
}

export type AppAction =
  | { type: 'SET_CONNECTION_STATE'; state: AppState['connectionState'] }
  | { type: 'SET_MODE'; mode: 'live' | 'mock' }
  | { type: 'SESSION_STATE'; session: SessionInfo }
  | { type: 'EVENT'; event: SessionEvent }
  | { type: 'PERMISSION_REQUEST'; approval: PendingApproval }
  | { type: 'PERMISSION_RESOLVED'; approvalId: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'RESET' };

export const initialState: AppState = {
  connectionState: 'disconnected',
  mode: null,
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

    case 'SESSION_STATE': {
      const sessions = new Map(state.sessions);
      sessions.set(action.session.id, action.session);
      return { ...state, sessions };
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
