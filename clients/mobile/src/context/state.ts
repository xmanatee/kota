import type {
  Approval,
  AttentionResponse,
  DaemonStatus,
  DigestResponse,
  HistorySearchResponse,
  KnowledgeSearchResponse,
  MemorySearchResponse,
  OwnerQuestion,
  RunSummary,
  TasksResponse,
  TasksSearchResponse,
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
  historyQuery: string;
  historyResult: HistorySearchResponse | null;
  historyLoading: boolean;
  historyError: string | null;
  tasksQuery: string;
  tasksResult: TasksSearchResponse | null;
  tasksLoading: boolean;
  tasksError: string | null;
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
  | { type: 'MEMORY_ERROR'; error: string }
  | { type: 'HISTORY_QUERY_SET'; query: string }
  | { type: 'HISTORY_LOADING'; query: string }
  | { type: 'HISTORY_RESULT'; result: HistorySearchResponse }
  | { type: 'HISTORY_ERROR'; error: string }
  | { type: 'TASKS_QUERY_SET'; query: string }
  | { type: 'TASKS_LOADING'; query: string }
  | { type: 'TASKS_RESULT'; result: TasksSearchResponse }
  | { type: 'TASKS_ERROR'; error: string };

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
  historyQuery: '',
  historyResult: null,
  historyLoading: false,
  historyError: null,
  tasksQuery: '',
  tasksResult: null,
  tasksLoading: false,
  tasksError: null,
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
        historyResult: action.online ? state.historyResult : null,
        historyError: action.online ? state.historyError : null,
        historyLoading: action.online ? state.historyLoading : false,
        tasksResult: action.online ? state.tasksResult : null,
        tasksError: action.online ? state.tasksError : null,
        tasksLoading: action.online ? state.tasksLoading : false,
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
    case 'HISTORY_QUERY_SET':
      return { ...state, historyQuery: action.query };
    case 'HISTORY_LOADING':
      return {
        ...state,
        historyQuery: action.query,
        historyLoading: true,
        historyError: null,
      };
    case 'HISTORY_RESULT':
      return {
        ...state,
        historyResult: action.result,
        historyLoading: false,
        historyError: null,
      };
    case 'HISTORY_ERROR':
      return {
        ...state,
        historyLoading: false,
        historyError: action.error,
        historyResult: null,
      };
    case 'TASKS_QUERY_SET':
      return { ...state, tasksQuery: action.query };
    case 'TASKS_LOADING':
      return {
        ...state,
        tasksQuery: action.query,
        tasksLoading: true,
        tasksError: null,
      };
    case 'TASKS_RESULT':
      return {
        ...state,
        tasksResult: action.result,
        tasksLoading: false,
        tasksError: null,
      };
    case 'TASKS_ERROR':
      return {
        ...state,
        tasksLoading: false,
        tasksError: action.error,
        tasksResult: null,
      };
  }
}
