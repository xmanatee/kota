import type {
  Approval,
  DaemonStatus,
  RunSummary,
  TasksResponse,
} from '../types';

export interface DaemonState {
  daemonUrl: string;
  token: string;
  settingsLoaded: boolean;
  online: boolean;
  sseConnected: boolean;
  status: DaemonStatus | null;
  runs: RunSummary[];
  approvals: Approval[];
  tasks: TasksResponse | null;
  pendingApprovalCount: number;
  pushNotificationsEnabled: boolean;
  error: string | null;
}

export type DaemonAction =
  | { type: 'SETTINGS_LOADED'; url: string; token: string; pushEnabled: boolean }
  | { type: 'SET_URL'; url: string }
  | { type: 'SET_TOKEN'; token: string }
  | { type: 'SET_PUSH_ENABLED'; enabled: boolean }
  | { type: 'ONLINE'; online: boolean }
  | { type: 'SSE_STATUS'; connected: boolean }
  | { type: 'STATUS'; status: DaemonStatus }
  | { type: 'RUNS'; runs: RunSummary[] }
  | { type: 'APPROVALS'; approvals: Approval[] }
  | { type: 'TASKS'; tasks: TasksResponse }
  | { type: 'PENDING_COUNT'; count: number }
  | { type: 'ERROR'; error: string | null };

export const initialState: DaemonState = {
  daemonUrl: '',
  token: '',
  settingsLoaded: false,
  online: false,
  sseConnected: false,
  status: null,
  runs: [],
  approvals: [],
  tasks: null,
  pendingApprovalCount: 0,
  pushNotificationsEnabled: true,
  error: null,
};

export function reducer(state: DaemonState, action: DaemonAction): DaemonState {
  switch (action.type) {
    case 'SETTINGS_LOADED':
      return {
        ...state,
        daemonUrl: action.url,
        token: action.token,
        pushNotificationsEnabled: action.pushEnabled,
        settingsLoaded: true,
      };
    case 'SET_URL':
      return { ...state, daemonUrl: action.url };
    case 'SET_TOKEN':
      return { ...state, token: action.token };
    case 'SET_PUSH_ENABLED':
      return { ...state, pushNotificationsEnabled: action.enabled };
    case 'ONLINE':
      return { ...state, online: action.online, error: action.online ? null : state.error };
    case 'SSE_STATUS':
      return { ...state, sseConnected: action.connected };
    case 'STATUS':
      return { ...state, status: action.status };
    case 'RUNS':
      return { ...state, runs: action.runs };
    case 'APPROVALS':
      return {
        ...state,
        approvals: action.approvals,
        pendingApprovalCount: action.approvals.filter((a) => a.status === 'pending').length,
      };
    case 'TASKS':
      return { ...state, tasks: action.tasks };
    case 'PENDING_COUNT':
      return { ...state, pendingApprovalCount: action.count };
    case 'ERROR':
      return { ...state, error: action.error };
  }
}
