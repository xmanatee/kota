import type {
  Approval,
  AttentionResponse,
  DaemonStatus,
  DigestResponse,
  KnowledgeSearchResponse,
  MemorySearchResponse,
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
  knowledgeQuery: string;
  knowledgeResult: KnowledgeSearchResponse | null;
  knowledgeLoading: boolean;
  knowledgeError: string | null;
  memoryQuery: string;
  memoryResult: MemorySearchResponse | null;
  memoryLoading: boolean;
  memoryError: string | null;
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
  | { type: 'ATTENTION_ERROR'; error: string }
  | { type: 'KNOWLEDGE_QUERY_SET'; query: string }
  | { type: 'KNOWLEDGE_LOADING'; query: string }
  | { type: 'KNOWLEDGE_RESULT'; result: KnowledgeSearchResponse }
  | { type: 'KNOWLEDGE_ERROR'; error: string }
  | { type: 'MEMORY_QUERY_SET'; query: string }
  | { type: 'MEMORY_LOADING'; query: string }
  | { type: 'MEMORY_RESULT'; result: MemorySearchResponse }
  | { type: 'MEMORY_ERROR'; error: string };

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
  knowledgeQuery: '',
  knowledgeResult: null,
  knowledgeLoading: false,
  knowledgeError: null,
  memoryQuery: '',
  memoryResult: null,
  memoryLoading: false,
  memoryError: null,
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
        knowledgeResult: action.online ? state.knowledgeResult : null,
        knowledgeError: action.online ? state.knowledgeError : null,
        knowledgeLoading: action.online ? state.knowledgeLoading : false,
        memoryResult: action.online ? state.memoryResult : null,
        memoryError: action.online ? state.memoryError : null,
        memoryLoading: action.online ? state.memoryLoading : false,
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
    case 'KNOWLEDGE_QUERY_SET':
      return { ...state, knowledgeQuery: action.query };
    case 'KNOWLEDGE_LOADING':
      return {
        ...state,
        knowledgeQuery: action.query,
        knowledgeLoading: true,
        knowledgeError: null,
      };
    case 'KNOWLEDGE_RESULT':
      return {
        ...state,
        knowledgeResult: action.result,
        knowledgeLoading: false,
        knowledgeError: null,
      };
    case 'KNOWLEDGE_ERROR':
      return {
        ...state,
        knowledgeLoading: false,
        knowledgeError: action.error,
        knowledgeResult: null,
      };
    case 'MEMORY_QUERY_SET':
      return { ...state, memoryQuery: action.query };
    case 'MEMORY_LOADING':
      return {
        ...state,
        memoryQuery: action.query,
        memoryLoading: true,
        memoryError: null,
      };
    case 'MEMORY_RESULT':
      return {
        ...state,
        memoryResult: action.result,
        memoryLoading: false,
        memoryError: null,
      };
    case 'MEMORY_ERROR':
      return {
        ...state,
        memoryLoading: false,
        memoryError: action.error,
        memoryResult: null,
      };
  }
}
