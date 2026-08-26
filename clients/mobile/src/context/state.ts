import type { ClientIdentity } from '../daemon/core';
import type {
  AnswerHistoryEntry,
  AnswerHistoryRecord,
  AnswerResult,
  Approval,
  AttentionResponse,
  CaptureResult,
  CaptureTarget,
  DaemonStatus,
  DigestResponse,
  HistorySearchResponse,
  KnowledgeSearchResponse,
  MemorySearchResponse,
  OwnerQuestion,
  RecallSearchResponse,
  RetractResult,
  RetractTarget,
  RunSummary,
  TasksResponse,
  TasksSearchResponse,
} from '../types';

/**
 * Picker selection for the capture target. `auto` collapses to "no
 * target on the wire" so the daemon classifier picks the destination.
 * Per-store values pin the contributor verbatim. The picker is the
 * mobile equivalent of the CLI `--target` flag.
 */
export type CaptureTargetChoice = 'auto' | CaptureTarget;

export interface ConnectionDomainState {
  daemonUrl: string;
  token: string;
  settingsLoaded: boolean;
  online: boolean;
  sseConnected: boolean;
  identity: ClientIdentity | null;
  pushNotificationsEnabled: boolean;
  error: string | null;
}

export interface ScopeDomainState {
  /**
   * The currently active scopeId. `null` until identity has resolved
   * the registry's default. Switches the scope-bound daemon routes
   * (`/status`, `/workflow/runs`, `/sessions`, …) without changing the
   * single-scope KOTA-on-itself experience — the picker hides itself
   * when the registry has exactly one entry.
   */
  activeScopeId: string | null;
}

export interface ActivityDomainState {
  status: DaemonStatus | null;
  runs: RunSummary[];
  approvals: Approval[];
  ownerQuestions: OwnerQuestion[];
  tasks: TasksResponse | null;
  pendingApprovalCount: number;
  pendingOwnerQuestionCount: number;
}

export interface ContentDomainState {
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
  recallQuery: string;
  recallResult: RecallSearchResponse | null;
  recallLoading: boolean;
  recallError: string | null;
  answerQuery: string;
  answerResult: AnswerResult | null;
  answerLoading: boolean;
  answerError: string | null;
  answerLogEntries: AnswerHistoryEntry[];
  answerLogLoading: boolean;
  answerLogError: string | null;
  answerLogHasMore: boolean;
  answerShowRecord: AnswerHistoryRecord | null;
  answerShowMissing: boolean;
  answerShowLoading: boolean;
  answerShowError: string | null;
  captureText: string;
  captureTarget: CaptureTargetChoice;
  captureHint: string;
  captureResult: CaptureResult | null;
  captureLoading: boolean;
  captureError: string | null;
  retractTarget: RetractTarget;
  retractIdentifier: string;
  retractResult: RetractResult | null;
  retractLoading: boolean;
  retractError: string | null;
  retractConfirmed: boolean;
}

export interface DaemonState {
  connection: ConnectionDomainState;
  scope: ScopeDomainState;
  activity: ActivityDomainState;
  content: ContentDomainState;
}

type DaemonActionBody =
  | { type: 'SETTINGS_LOADED'; url: string; token: string; pushEnabled: boolean }
  | { type: 'SET_URL'; url: string }
  | { type: 'SET_TOKEN'; token: string }
  | { type: 'SET_PUSH_ENABLED'; enabled: boolean }
  | { type: 'ONLINE'; online: boolean }
  | { type: 'SSE_STATUS'; connected: boolean }
  | { type: 'IDENTITY'; identity: ClientIdentity; activeScopeId: string }
  | { type: 'IDENTITY_CLEARED' }
  | { type: 'ACTIVE_SCOPE'; scopeId: string }
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
  | { type: 'TASKS_ERROR'; error: string }
  | { type: 'RECALL_QUERY_SET'; query: string }
  | { type: 'RECALL_LOADING'; query: string }
  | { type: 'RECALL_RESULT'; result: RecallSearchResponse }
  | { type: 'RECALL_ERROR'; error: string }
  | { type: 'ANSWER_QUERY_SET'; query: string }
  | { type: 'ANSWER_LOADING'; query: string }
  | { type: 'ANSWER_RESULT'; result: AnswerResult }
  | { type: 'ANSWER_ERROR'; error: string }
  | { type: 'ANSWER_LOG_LOADING'; reset: boolean }
  | {
      type: 'ANSWER_LOG_RESULT';
      entries: AnswerHistoryEntry[];
      append: boolean;
      hasMore: boolean;
    }
  | { type: 'ANSWER_LOG_ERROR'; error: string }
  | { type: 'ANSWER_SHOW_LOADING'; id: string }
  | { type: 'ANSWER_SHOW_RESULT'; record: AnswerHistoryRecord }
  | { type: 'ANSWER_SHOW_NOT_FOUND' }
  | { type: 'ANSWER_SHOW_ERROR'; error: string }
  | { type: 'ANSWER_SHOW_CLOSE' }
  | { type: 'CAPTURE_TEXT_SET'; text: string }
  | { type: 'CAPTURE_TARGET_SET'; target: CaptureTargetChoice }
  | { type: 'CAPTURE_HINT_SET'; hint: string }
  | { type: 'CAPTURE_LOADING' }
  | { type: 'CAPTURE_RESULT'; result: CaptureResult }
  | { type: 'CAPTURE_ERROR'; error: string }
  | { type: 'RETRACT_TARGET_SET'; target: RetractTarget }
  | { type: 'RETRACT_IDENTIFIER_SET'; identifier: string }
  | { type: 'RETRACT_CONFIRMED_SET'; confirmed: boolean }
  | { type: 'RETRACT_LOADING' }
  | { type: 'RETRACT_RESULT'; result: RetractResult }
  | { type: 'RETRACT_ERROR'; error: string };

/**
 * Async completions may carry the scope that initiated them. The root reducer
 * drops a completion after the operator has switched scopes, so old responses
 * cannot repopulate a freshly invalidated domain store.
 */
export type DaemonAction = DaemonActionBody & {
  requestScopeId?: string | null;
};

export const initialConnectionState: ConnectionDomainState = {
  daemonUrl: '',
  token: '',
  settingsLoaded: false,
  online: false,
  sseConnected: false,
  identity: null,
  pushNotificationsEnabled: true,
  error: null,
};

export const initialScopeState: ScopeDomainState = {
  activeScopeId: null,
};

export const initialActivityState: ActivityDomainState = {
  status: null,
  runs: [],
  approvals: [],
  ownerQuestions: [],
  tasks: null,
  pendingApprovalCount: 0,
  pendingOwnerQuestionCount: 0,
};

export const initialContentState: ContentDomainState = {
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
  recallQuery: '',
  recallResult: null,
  recallLoading: false,
  recallError: null,
  answerQuery: '',
  answerResult: null,
  answerLoading: false,
  answerError: null,
  answerLogEntries: [],
  answerLogLoading: false,
  answerLogError: null,
  answerLogHasMore: false,
  answerShowRecord: null,
  answerShowMissing: false,
  answerShowLoading: false,
  answerShowError: null,
  captureText: '',
  captureTarget: 'auto',
  captureHint: '',
  captureResult: null,
  captureLoading: false,
  captureError: null,
  retractTarget: 'memory',
  retractIdentifier: '',
  retractResult: null,
  retractLoading: false,
  retractError: null,
  retractConfirmed: false,
};

export const initialState: DaemonState = {
  connection: initialConnectionState,
  scope: initialScopeState,
  activity: initialActivityState,
  content: initialContentState,
};

function clearLiveContent(state: ContentDomainState): ContentDomainState {
  return {
    ...initialContentState,
    knowledgeQuery: state.knowledgeQuery,
    memoryQuery: state.memoryQuery,
    historyQuery: state.historyQuery,
    tasksQuery: state.tasksQuery,
    recallQuery: state.recallQuery,
    answerQuery: state.answerQuery,
    captureText: state.captureText,
    captureTarget: state.captureTarget,
    captureHint: state.captureHint,
    retractTarget: state.retractTarget,
    retractIdentifier: state.retractIdentifier,
  };
}

function reduceConnection(
  state: ConnectionDomainState,
  action: DaemonAction,
): ConnectionDomainState {
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
      };
    case 'SSE_STATUS':
      return { ...state, sseConnected: action.connected };
    case 'IDENTITY':
      return { ...state, identity: action.identity };
    case 'IDENTITY_CLEARED':
      return { ...state, identity: null };
    case 'ERROR':
      return { ...state, error: action.error };
    default:
      return state;
  }
}

function reduceActivity(
  state: ActivityDomainState,
  action: DaemonAction,
): ActivityDomainState {
  switch (action.type) {
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
    default:
      return state;
  }
}

function reduceContent(
  state: ContentDomainState,
  action: DaemonAction,
): ContentDomainState {
  switch (action.type) {
    case 'ONLINE':
      return action.online ? state : clearLiveContent(state);
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
    case 'RECALL_QUERY_SET':
      return { ...state, recallQuery: action.query };
    case 'RECALL_LOADING':
      return {
        ...state,
        recallQuery: action.query,
        recallLoading: true,
        recallError: null,
      };
    case 'RECALL_RESULT':
      return {
        ...state,
        recallResult: action.result,
        recallLoading: false,
        recallError: null,
      };
    case 'RECALL_ERROR':
      return {
        ...state,
        recallLoading: false,
        recallError: action.error,
        recallResult: null,
      };
    case 'ANSWER_QUERY_SET':
      return { ...state, answerQuery: action.query };
    case 'ANSWER_LOADING':
      return {
        ...state,
        answerQuery: action.query,
        answerLoading: true,
        answerError: null,
      };
    case 'ANSWER_RESULT':
      return {
        ...state,
        answerResult: action.result,
        answerLoading: false,
        answerError: null,
      };
    case 'ANSWER_ERROR':
      return {
        ...state,
        answerLoading: false,
        answerError: action.error,
        answerResult: null,
      };
    case 'ANSWER_LOG_LOADING':
      return {
        ...state,
        answerLogLoading: true,
        answerLogError: null,
        answerLogEntries: action.reset ? [] : state.answerLogEntries,
        answerLogHasMore: action.reset ? false : state.answerLogHasMore,
      };
    case 'ANSWER_LOG_RESULT':
      return {
        ...state,
        answerLogEntries: action.append
          ? [...state.answerLogEntries, ...action.entries]
          : action.entries,
        answerLogLoading: false,
        answerLogError: null,
        answerLogHasMore: action.hasMore,
      };
    case 'ANSWER_LOG_ERROR':
      return {
        ...state,
        answerLogLoading: false,
        answerLogError: action.error,
      };
    case 'ANSWER_SHOW_LOADING':
      return {
        ...state,
        answerShowLoading: true,
        answerShowError: null,
        answerShowRecord: null,
        answerShowMissing: false,
      };
    case 'ANSWER_SHOW_RESULT':
      return {
        ...state,
        answerShowRecord: action.record,
        answerShowMissing: false,
        answerShowLoading: false,
        answerShowError: null,
      };
    case 'ANSWER_SHOW_NOT_FOUND':
      return {
        ...state,
        answerShowRecord: null,
        answerShowMissing: true,
        answerShowLoading: false,
        answerShowError: null,
      };
    case 'ANSWER_SHOW_ERROR':
      return {
        ...state,
        answerShowLoading: false,
        answerShowError: action.error,
        answerShowRecord: null,
        answerShowMissing: false,
      };
    case 'ANSWER_SHOW_CLOSE':
      return {
        ...state,
        answerShowRecord: null,
        answerShowMissing: false,
        answerShowLoading: false,
        answerShowError: null,
      };
    case 'CAPTURE_TEXT_SET':
      return { ...state, captureText: action.text };
    case 'CAPTURE_TARGET_SET':
      return { ...state, captureTarget: action.target };
    case 'CAPTURE_HINT_SET':
      return { ...state, captureHint: action.hint };
    case 'CAPTURE_LOADING':
      return { ...state, captureLoading: true, captureError: null };
    case 'CAPTURE_RESULT':
      return {
        ...state,
        captureResult: action.result,
        captureLoading: false,
        captureError: null,
      };
    case 'CAPTURE_ERROR':
      return {
        ...state,
        captureLoading: false,
        captureError: action.error,
        captureResult: null,
      };
    case 'RETRACT_TARGET_SET':
      if (state.retractTarget === action.target) return state;
      return {
        ...state,
        retractTarget: action.target,
        retractIdentifier: '',
        retractResult: null,
        retractError: null,
        retractConfirmed: false,
      };
    case 'RETRACT_IDENTIFIER_SET':
      if (state.retractIdentifier === action.identifier) return state;
      return {
        ...state,
        retractIdentifier: action.identifier,
        retractConfirmed: false,
      };
    case 'RETRACT_CONFIRMED_SET':
      return { ...state, retractConfirmed: action.confirmed };
    case 'RETRACT_LOADING':
      return {
        ...state,
        retractLoading: true,
        retractError: null,
        retractResult: null,
        retractConfirmed: false,
      };
    case 'RETRACT_RESULT':
      return {
        ...state,
        retractResult: action.result,
        retractLoading: false,
        retractError: null,
      };
    case 'RETRACT_ERROR':
      return {
        ...state,
        retractLoading: false,
        retractError: action.error,
        retractResult: null,
      };
    default:
      return state;
  }
}

export function reducer(state: DaemonState, action: DaemonAction): DaemonState {
  if (
    'requestScopeId' in action &&
    action.requestScopeId !== state.scope.activeScopeId
  ) {
    return state;
  }

  if (action.type === 'ACTIVE_SCOPE') {
    if (state.scope.activeScopeId === action.scopeId) return state;
    return {
      ...state,
      scope: { activeScopeId: action.scopeId },
      activity: { ...state.activity, status: null, runs: [] },
      content: clearLiveContent(state.content),
    };
  }

  if (action.type === 'IDENTITY') {
    return {
      ...state,
      connection: reduceConnection(state.connection, action),
      scope: { activeScopeId: action.activeScopeId },
    };
  }

  if (action.type === 'IDENTITY_CLEARED') {
    return {
      ...state,
      connection: reduceConnection(state.connection, action),
      scope: initialScopeState,
    };
  }

  const connection = reduceConnection(state.connection, action);
  const activity = reduceActivity(state.activity, action);
  const content = reduceContent(state.content, action);
  if (
    connection === state.connection &&
    activity === state.activity &&
    content === state.content
  ) {
    return state;
  }
  return { ...state, connection, activity, content };
}
