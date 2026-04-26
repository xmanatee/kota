import type {
  Approval,
  AttentionResponse,
  DaemonStatus,
  DigestResponse,
  OwnerQuestion,
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
  ownerQuestions: OwnerQuestion[];
  tasks: TasksResponse | null;
  pendingApprovalCount: number;
  pendingOwnerQuestionCount: number;
  pushNotificationsEnabled: boolean;
  error: string | null;
  digest: DigestResponse | null;
  digestLoading: boolean;
  digestError: string | null;
  attention: AttentionResponse | null;
  attentionLoading: boolean;
  attentionError: string | null;
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
  | { type: 'OWNER_QUESTIONS'; questions: OwnerQuestion[] }
  | { type: 'TASKS'; tasks: TasksResponse }
  | { type: 'PENDING_COUNT'; count: number }
  | { type: 'ERROR'; error: string | null }
  | { type: 'DIGEST_LOADING' }
  | { type: 'DIGEST_RESULT'; digest: DigestResponse }
  | { type: 'DIGEST_ERROR'; error: string }
  | { type: 'ATTENTION_LOADING' }
  | { type: 'ATTENTION_RESULT'; attention: AttentionResponse }
  | { type: 'ATTENTION_ERROR'; error: string };

export const initialState: DaemonState = {
  daemonUrl: '',
  token: '',
  settingsLoaded: false,
  online: false,
  sseConnected: false,
  status: null,
  runs: [],
  approvals: [],
  ownerQuestions: [],
  tasks: null,
  pendingApprovalCount: 0,
  pendingOwnerQuestionCount: 0,
  pushNotificationsEnabled: true,
  error: null,
  digest: null,
  digestLoading: false,
  digestError: null,
  attention: null,
  attentionLoading: false,
  attentionError: null,
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
      return {
        ...state,
        online: action.online,
        error: action.online ? null : state.error,
        digest: action.online ? state.digest : null,
        digestError: action.online ? state.digestError : null,
        digestLoading: action.online ? state.digestLoading : false,
        attention: action.online ? state.attention : null,
        attentionError: action.online ? state.attentionError : null,
        attentionLoading: action.online ? state.attentionLoading : false,
      };
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
    case 'OWNER_QUESTIONS':
      return {
        ...state,
        ownerQuestions: action.questions,
        pendingOwnerQuestionCount: action.questions.filter((q) => q.status === 'pending').length,
      };
    case 'TASKS':
      return { ...state, tasks: action.tasks };
    case 'PENDING_COUNT':
      return { ...state, pendingApprovalCount: action.count };
    case 'ERROR':
      return { ...state, error: action.error };
    case 'DIGEST_LOADING':
      return { ...state, digestLoading: true, digestError: null };
    case 'DIGEST_RESULT':
      return {
        ...state,
        digest: action.digest,
        digestLoading: false,
        digestError: null,
      };
    case 'DIGEST_ERROR':
      return {
        ...state,
        digestLoading: false,
        digestError: action.error,
        digest: null,
      };
    case 'ATTENTION_LOADING':
      return { ...state, attentionLoading: true, attentionError: null };
    case 'ATTENTION_RESULT':
      return {
        ...state,
        attention: action.attention,
        attentionLoading: false,
        attentionError: null,
      };
    case 'ATTENTION_ERROR':
      return {
        ...state,
        attentionLoading: false,
        attentionError: action.error,
        attention: null,
      };
  }
}
