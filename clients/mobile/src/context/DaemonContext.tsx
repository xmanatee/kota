import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { DaemonClient } from '../daemonClient';
import { useSSE } from '../hooks/useSSE';
import { registerPushTokenWithDaemon } from '../pushNotifications';
import type {
  AnswerHistoryListFilter,
  CaptureFilter,
  RetractRequest,
  RetractTarget,
  SseEvent,
  UiAction,
  UiActionExecutionResult,
  UiJsonValue,
  UiLogEntry,
  UiSurfaceBundle,
} from '../types';
import { matchUiEvent, uiLogEntry } from '../shared-ui/live-events';
import {
  type CaptureTargetChoice,
  type DaemonState,
  initialState,
  reducer,
} from './state';

const URL_KEY = 'kota_daemon_url';
const TOKEN_KEY = 'kota_daemon_token';
const PUSH_ENABLED_KEY = 'kota_push_notifications_enabled';

export type LiveUiLogEntries = Readonly<
  Record<string, readonly UiLogEntry[]>
>;

export type SharedUiState = {
  bundle: UiSurfaceBundle | null;
  loading: boolean;
  error: string | null;
  liveLogEntries: LiveUiLogEntries;
};

const initialSharedUiState: SharedUiState = {
  bundle: null,
  loading: false,
  error: null,
  liveLogEntries: {},
};

interface DaemonContextValue {
  state: DaemonState;
  ui: SharedUiState;
  client: DaemonClient | null;
  saveSettings: (url: string, token: string) => Promise<void>;
  setPushNotificationsEnabled: (enabled: boolean) => Promise<void>;
  setActiveScopeId: (scopeId: string) => void;
  refresh: () => void;
  refreshUi: () => Promise<void>;
  executeUiAction: (
    action: UiAction,
    parameters?: UiJsonValue,
  ) => Promise<UiActionExecutionResult>;
  refreshDigest: () => Promise<void>;
  refreshAttention: () => Promise<void>;
  setKnowledgeQuery: (query: string) => void;
  searchKnowledge: (query: string) => Promise<void>;
  setMemoryQuery: (query: string) => void;
  searchMemory: (query: string) => Promise<void>;
  setHistoryQuery: (query: string) => void;
  searchHistory: (query: string) => Promise<void>;
  setTasksQuery: (query: string) => void;
  searchTasks: (query: string) => Promise<void>;
  setRecallQuery: (query: string) => void;
  recall: (query: string) => Promise<void>;
  setAnswerQuery: (query: string) => void;
  answer: (query: string) => Promise<void>;
  loadAnswerLog: (opts?: AnswerHistoryListFilter) => Promise<void>;
  loadMoreAnswerLog: () => Promise<void>;
  openAnswerShow: (id: string) => Promise<void>;
  closeAnswerShow: () => void;
  setCaptureText: (text: string) => void;
  setCaptureTarget: (target: CaptureTargetChoice) => void;
  setCaptureHint: (hint: string) => void;
  capture: (text: string, options?: CaptureFilter) => Promise<void>;
  setRetractTarget: (target: RetractTarget) => void;
  setRetractIdentifier: (identifier: string) => void;
  setRetractConfirmed: (confirmed: boolean) => void;
  retract: (request: RetractRequest) => Promise<void>;
}

const DaemonContext = createContext<DaemonContextValue>({
  state: initialState,
  ui: initialSharedUiState,
  client: null,
  saveSettings: async () => {},
  setPushNotificationsEnabled: async () => {},
  setActiveScopeId: () => {},
  refresh: () => {},
  refreshUi: async () => {},
  executeUiAction: async () => ({
    ok: false,
    reason: 'unavailable',
    message: 'Daemon connection is unavailable.',
  }),
  refreshDigest: async () => {},
  refreshAttention: async () => {},
  setKnowledgeQuery: () => {},
  searchKnowledge: async () => {},
  setMemoryQuery: () => {},
  searchMemory: async () => {},
  setHistoryQuery: () => {},
  searchHistory: async () => {},
  setTasksQuery: () => {},
  searchTasks: async () => {},
  setRecallQuery: () => {},
  recall: async () => {},
  setAnswerQuery: () => {},
  answer: async () => {},
  loadAnswerLog: async () => {},
  loadMoreAnswerLog: async () => {},
  openAnswerShow: async () => {},
  closeAnswerShow: () => {},
  setCaptureText: () => {},
  setCaptureTarget: () => {},
  setCaptureHint: () => {},
  capture: async () => {},
  setRetractTarget: () => {},
  setRetractIdentifier: () => {},
  setRetractConfirmed: () => {},
  retract: async () => {},
});

export function DaemonProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [ui, setUi] = useState<SharedUiState>(initialSharedUiState);
  const clientRef = useRef<DaemonClient | null>(null);
  const refreshRequestRef = useRef(0);
  const uiRef = useRef(ui);
  const uiRequestRef = useRef(0);
  const uiRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pushRegisteredRef = useRef(false);

  useEffect(() => {
    uiRef.current = ui;
  }, [ui]);

  // Load persisted settings on mount
  useEffect(() => {
    async function load() {
      const [url, token, pushEnabledRaw] = await Promise.all([
        SecureStore.getItemAsync(URL_KEY),
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(PUSH_ENABLED_KEY),
      ]);
      const pushEnabled = pushEnabledRaw !== 'false';
      dispatch({ type: 'SETTINGS_LOADED', url: url ?? '', token: token ?? '', pushEnabled });
    }
    void load();
  }, []);

  // Rebuild client when URL/token changes
  useEffect(() => {
    if (!state.connection.settingsLoaded) return;
    clientRef.current = state.connection.daemonUrl && state.connection.token
      ? new DaemonClient(state.connection.daemonUrl, state.connection.token)
      : null;
    refreshRequestRef.current += 1;
    uiRequestRef.current += 1;
    setUi(initialSharedUiState);
    pushRegisteredRef.current = false;
  }, [state.connection.daemonUrl, state.connection.token, state.connection.settingsLoaded]);

  // The reducer owns the active scopeId; we mirror it through a ref so
  // the polling loop reads the *latest* selection without re-running on
  // every change. Both `fetchAll` and the SSE handler dispatch updates
  // through this ref so a scope switch immediately routes new fetches
  // to the chosen scope.
  const activeScopeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeScopeIdRef.current = state.scope.activeScopeId;
  }, [state.scope.activeScopeId]);

  const fetchUiSurfaces = useCallback(async (scopeId?: string) => {
    const requestId = ++uiRequestRef.current;
    const client = clientRef.current;
    if (!client) {
      setUi(initialSharedUiState);
      return;
    }
    setUi((current) => ({ ...current, loading: true, error: null }));
    try {
      const bundle = await client.getUiSurfaces(scopeId);
      if (requestId !== uiRequestRef.current) return;
      setUi((current) => ({
        ...current,
        bundle,
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (requestId !== uiRequestRef.current) return;
      setUi((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  const scheduleUiRefresh = useCallback(() => {
    if (uiRefreshTimerRef.current !== null) return;
    uiRefreshTimerRef.current = setTimeout(() => {
      uiRefreshTimerRef.current = null;
      void fetchUiSurfaces(activeScopeIdRef.current ?? undefined);
    }, 200);
  }, [fetchUiSurfaces]);

  useEffect(() => () => {
    if (uiRefreshTimerRef.current !== null) {
      clearTimeout(uiRefreshTimerRef.current);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const requestId = ++refreshRequestRef.current;
    try {
      // Resolve identity first so the registry's default scopeId seeds
      // `activeScopeId` before the scope-aware fetches fan out.
      const identity = await client.getIdentity();
      if (requestId !== refreshRequestRef.current || client !== clientRef.current) return;
      const knownIds = new Set(
        identity.scopeRegistry.scopes
          .filter((scope) => scope.directoryRoot !== undefined)
          .map((scope) => scope.scopeId),
      );
      const previous = activeScopeIdRef.current;
      const nextScopeId =
        previous && knownIds.has(previous)
          ? previous
          : identity.scopeRegistry.defaultScopeId;
      dispatch({
        type: 'IDENTITY',
        identity,
        activeScopeId: nextScopeId,
      });
      activeScopeIdRef.current = nextScopeId;

      void fetchUiSurfaces(nextScopeId);

      const [statusRes, runsRes, approvalsRes, tasksRes, ownerQuestionsRes] = await Promise.all([
        client.getStatus(nextScopeId),
        client.getRuns(undefined, 30, nextScopeId),
        client.getApprovals(),
        client.getTasks(),
        client.getOwnerQuestions(),
      ]);
      if (requestId !== refreshRequestRef.current || client !== clientRef.current) return;
      dispatch({ type: 'STATUS', status: statusRes, requestScopeId: nextScopeId });
      dispatch({ type: 'RUNS', runs: runsRes.runs, requestScopeId: nextScopeId });
      dispatch({ type: 'APPROVALS', approvals: approvalsRes.approvals });
      dispatch({ type: 'TASKS', tasks: tasksRes });
      dispatch({ type: 'OWNER_QUESTIONS', questions: ownerQuestionsRes.questions });
      dispatch({ type: 'ERROR', error: null });
    } catch (e) {
      if (requestId !== refreshRequestRef.current || client !== clientRef.current) return;
      dispatch({ type: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    }
  }, [fetchUiSurfaces]);

  // Health check loop
  useEffect(() => {
    if (!state.connection.settingsLoaded) return;

    async function checkHealth() {
      const client = clientRef.current;
      if (!client) {
        refreshRequestRef.current += 1;
        dispatch({ type: 'ONLINE', online: false });
        setUi(initialSharedUiState);
        return;
      }
      try {
        await client.health();
        dispatch({ type: 'ONLINE', online: true });
        void fetchAll();
      } catch {
        refreshRequestRef.current += 1;
        dispatch({ type: 'ONLINE', online: false });
        setUi(initialSharedUiState);
      }
    }

    void checkHealth();
    healthTimerRef.current = setInterval(() => void checkHealth(), 15_000);
    return () => {
      if (healthTimerRef.current !== null) clearInterval(healthTimerRef.current);
    };
  }, [state.connection.settingsLoaded, state.connection.daemonUrl, state.connection.token, fetchAll]);

  // Register push token once when online and push notifications enabled
  useEffect(() => {
    const client = clientRef.current;
    if (!state.connection.online || !client || pushRegisteredRef.current) return;
    if (!state.connection.pushNotificationsEnabled) return;
    pushRegisteredRef.current = true;
    void registerPushTokenWithDaemon(client).catch(() => {
      pushRegisteredRef.current = false;
    });
  }, [state.connection.online, state.connection.pushNotificationsEnabled]);

  useEffect(() => {
    if (!state.connection.online || state.connection.sseConnected) {
      if (pollTimerRef.current !== null) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    pollTimerRef.current = setInterval(() => void fetchAll(), 10_000);
    return () => {
      if (pollTimerRef.current !== null) clearInterval(pollTimerRef.current);
    };
  }, [state.connection.online, state.connection.sseConnected, fetchAll]);

  const handleSseEvent = useCallback((event: SseEvent) => {
    const client = clientRef.current;
    if (!client) return;
    const scopeId = activeScopeIdRef.current ?? undefined;
    const uiMatch = matchUiEvent(uiRef.current.bundle, event);
    if (uiMatch.refresh) scheduleUiRefresh();
    if (uiMatch.streamIds.length > 0) {
      const entry = uiLogEntry(event);
      setUi((current) => {
        const liveLogEntries = { ...current.liveLogEntries };
        for (const streamId of uiMatch.streamIds) {
          liveLogEntries[streamId] = [
            ...(current.liveLogEntries[streamId] ?? []),
            entry,
          ].slice(-100);
        }
        return { ...current, liveLogEntries };
      });
    }

    switch (event.type) {
      case 'workflow.started':
      case 'workflow.completed':
      case 'queue.changed':
        void client
          .getStatus(scopeId)
          .then((s) => dispatch({ type: 'STATUS', status: s, requestScopeId: scopeId ?? null }));
        void client
          .getRuns(undefined, 30, scopeId)
          .then((r) => dispatch({ type: 'RUNS', runs: r.runs, requestScopeId: scopeId ?? null }));
        break;
      case 'approval.changed': {
        const count = event.payload.pendingCount;
        if (typeof count === 'number') {
          dispatch({ type: 'PENDING_COUNT', count });
        }
        void client.getApprovals().then((r) => dispatch({ type: 'APPROVALS', approvals: r.approvals }));
        break;
      }
      case 'task.changed':
        void client.getTasks().then((t) => dispatch({ type: 'TASKS', tasks: t }));
        break;
      case 'owner.question.asked':
      case 'owner.question.changed':
      case 'owner.question.resolved':
      case 'owner.question.dismissed':
      case 'owner.question.expired':
        void client
          .getOwnerQuestions()
          .then((r) => dispatch({ type: 'OWNER_QUESTIONS', questions: r.questions }));
        break;
    }
  }, [scheduleUiRefresh]);

  const handleSseStatus = useCallback((connected: boolean) => {
    dispatch({ type: 'SSE_STATUS', connected });
  }, []);

  const sseUrl = state.connection.online && clientRef.current
    ? clientRef.current.sseUrl()
    : null;
  const authHeader = clientRef.current?.authHeader ?? null;

  useSSE(sseUrl, authHeader, handleSseEvent, handleSseStatus, (_raw, error) => {
    console.warn(`Malformed daemon event: ${error.message}`);
  });

  const saveSettings = useCallback(async (url: string, token: string) => {
    await Promise.all([
      SecureStore.setItemAsync(URL_KEY, url),
      SecureStore.setItemAsync(TOKEN_KEY, token),
    ]);
    dispatch({ type: 'SET_URL', url });
    dispatch({ type: 'SET_TOKEN', token });
  }, []);

  const setActiveScopeId = useCallback((scopeId: string) => {
    activeScopeIdRef.current = scopeId;
    refreshRequestRef.current += 1;
    uiRequestRef.current += 1;
    setUi(initialSharedUiState);
    dispatch({ type: 'ACTIVE_SCOPE', scopeId });
    void fetchAll();
  }, [fetchAll]);

  const setPushNotificationsEnabled = useCallback(async (enabled: boolean) => {
    await SecureStore.setItemAsync(PUSH_ENABLED_KEY, enabled ? 'true' : 'false');
    dispatch({ type: 'SET_PUSH_ENABLED', enabled });
    if (enabled) {
      pushRegisteredRef.current = false;
    }
  }, []);

  const refresh = useCallback(() => {
    void fetchAll();
  }, [fetchAll]);

  const refreshUi = useCallback(async () => {
    await fetchUiSurfaces(activeScopeIdRef.current ?? undefined);
  }, [fetchUiSurfaces]);

  const executeSharedUiAction = useCallback(
    async (action: UiAction, parameters?: UiJsonValue) => {
      const client = clientRef.current;
      if (!client) throw new Error('Daemon connection is unavailable.');
      const result = await client.executeUiAction(action, parameters);
      if (result.ok) {
        await fetchUiSurfaces(activeScopeIdRef.current ?? undefined);
      }
      return result;
    },
    [fetchUiSurfaces],
  );

  const refreshDigest = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const requestScopeId = activeScopeIdRef.current;
    dispatch({ type: 'DIGEST_LOADING' });
    try {
      const digest = await client.getDigest();
      dispatch({ type: 'DIGEST_RESULT', digest, requestScopeId });
    } catch (e) {
      dispatch({
        type: 'DIGEST_ERROR',
        error: e instanceof Error ? e.message : String(e),
        requestScopeId,
      });
    }
  }, []);

  const refreshAttention = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const requestScopeId = activeScopeIdRef.current;
    dispatch({ type: 'ATTENTION_LOADING' });
    try {
      const attention = await client.getAttention();
      dispatch({ type: 'ATTENTION_RESULT', attention, requestScopeId });
    } catch (e) {
      dispatch({
        type: 'ATTENTION_ERROR',
        error: e instanceof Error ? e.message : String(e),
        requestScopeId,
      });
    }
  }, []);

  const setKnowledgeQuery = useCallback((query: string) => {
    dispatch({ type: 'KNOWLEDGE_QUERY_SET', query });
  }, []);

  const searchKnowledge = useCallback(async (query: string) => {
    const client = clientRef.current;
    if (!client) return;
    if (query.trim().length === 0) return;
    const requestScopeId = activeScopeIdRef.current;
    dispatch({ type: 'KNOWLEDGE_LOADING', query });
    try {
      const result = await client.searchKnowledge(query, 10);
      dispatch({ type: 'KNOWLEDGE_RESULT', result, requestScopeId });
    } catch (e) {
      dispatch({
        type: 'KNOWLEDGE_ERROR',
        error: e instanceof Error ? e.message : String(e),
        requestScopeId,
      });
    }
  }, []);

  const setMemoryQuery = useCallback((query: string) => {
    dispatch({ type: 'MEMORY_QUERY_SET', query });
  }, []);

  const searchMemory = useCallback(async (query: string) => {
    const client = clientRef.current;
    if (!client) return;
    if (query.trim().length === 0) return;
    const requestScopeId = activeScopeIdRef.current;
    dispatch({ type: 'MEMORY_LOADING', query });
    try {
      const result = await client.searchMemory(query, 10);
      dispatch({ type: 'MEMORY_RESULT', result, requestScopeId });
    } catch (e) {
      dispatch({
        type: 'MEMORY_ERROR',
        error: e instanceof Error ? e.message : String(e),
        requestScopeId,
      });
    }
  }, []);

  const setHistoryQuery = useCallback((query: string) => {
    dispatch({ type: 'HISTORY_QUERY_SET', query });
  }, []);

  const searchHistory = useCallback(async (query: string) => {
    const client = clientRef.current;
    if (!client) return;
    if (query.trim().length === 0) return;
    const requestScopeId = activeScopeIdRef.current;
    dispatch({ type: 'HISTORY_LOADING', query });
    try {
      const result = await client.searchHistory(query, 10);
      dispatch({ type: 'HISTORY_RESULT', result, requestScopeId });
    } catch (e) {
      dispatch({
        type: 'HISTORY_ERROR',
        error: e instanceof Error ? e.message : String(e),
        requestScopeId,
      });
    }
  }, []);

  const setTasksQuery = useCallback((query: string) => {
    dispatch({ type: 'TASKS_QUERY_SET', query });
  }, []);

  const searchTasks = useCallback(async (query: string) => {
    const client = clientRef.current;
    if (!client) return;
    if (query.trim().length === 0) return;
    const requestScopeId = activeScopeIdRef.current;
    dispatch({ type: 'TASKS_LOADING', query });
    try {
      const result = await client.searchTasks(query, 10);
      dispatch({ type: 'TASKS_RESULT', result, requestScopeId });
    } catch (e) {
      dispatch({
        type: 'TASKS_ERROR',
        error: e instanceof Error ? e.message : String(e),
        requestScopeId,
      });
    }
  }, []);

  const setRecallQuery = useCallback((query: string) => {
    dispatch({ type: 'RECALL_QUERY_SET', query });
  }, []);

  const recall = useCallback(async (query: string) => {
    const client = clientRef.current;
    if (!client) return;
    if (query.trim().length === 0) return;
    const requestScopeId = activeScopeIdRef.current;
    dispatch({ type: 'RECALL_LOADING', query });
    try {
      const result = await client.recall(query);
      dispatch({ type: 'RECALL_RESULT', result, requestScopeId });
    } catch (e) {
      dispatch({
        type: 'RECALL_ERROR',
        error: e instanceof Error ? e.message : String(e),
        requestScopeId,
      });
    }
  }, []);

  const setAnswerQuery = useCallback((query: string) => {
    dispatch({ type: 'ANSWER_QUERY_SET', query });
  }, []);

  const answer = useCallback(async (query: string) => {
    const client = clientRef.current;
    if (!client) return;
    if (query.trim().length === 0) return;
    const requestScopeId = activeScopeIdRef.current;
    dispatch({ type: 'ANSWER_LOADING', query });
    try {
      const result = await client.answer(query);
      dispatch({ type: 'ANSWER_RESULT', result, requestScopeId });
    } catch (e) {
      dispatch({
        type: 'ANSWER_ERROR',
        error: e instanceof Error ? e.message : String(e),
        requestScopeId,
      });
    }
  }, []);

  const ANSWER_LOG_PAGE_SIZE = 20;

  const loadAnswerLog = useCallback(
    async (opts?: AnswerHistoryListFilter) => {
      const client = clientRef.current;
      if (!client) return;
      const requestScopeId = activeScopeIdRef.current;
      const limit = opts?.limit ?? ANSWER_LOG_PAGE_SIZE;
      const append = opts?.beforeId !== undefined;
      dispatch({ type: 'ANSWER_LOG_LOADING', reset: !append });
      try {
        const filter: AnswerHistoryListFilter = { limit };
        if (opts?.beforeId !== undefined) filter.beforeId = opts.beforeId;
        const result = await client.answerLog(filter);
        dispatch({
          type: 'ANSWER_LOG_RESULT',
          entries: result.entries,
          append,
          hasMore: result.entries.length >= limit,
          requestScopeId,
        });
      } catch (e) {
        dispatch({
          type: 'ANSWER_LOG_ERROR',
          error: e instanceof Error ? e.message : String(e),
          requestScopeId,
        });
      }
    },
    [],
  );

  const loadMoreAnswerLog = useCallback(async () => {
    const last = state.content.answerLogEntries[state.content.answerLogEntries.length - 1];
    if (!last) return;
    await loadAnswerLog({ beforeId: last.id });
  }, [state.content.answerLogEntries, loadAnswerLog]);

  const openAnswerShow = useCallback(async (id: string) => {
    const client = clientRef.current;
    if (!client) return;
    const requestScopeId = activeScopeIdRef.current;
    dispatch({ type: 'ANSWER_SHOW_LOADING', id });
    try {
      const result = await client.answerShow(id);
      if (result.ok) {
        dispatch({ type: 'ANSWER_SHOW_RESULT', record: result.record, requestScopeId });
      } else {
        dispatch({ type: 'ANSWER_SHOW_NOT_FOUND', requestScopeId });
      }
    } catch (e) {
      dispatch({
        type: 'ANSWER_SHOW_ERROR',
        error: e instanceof Error ? e.message : String(e),
        requestScopeId,
      });
    }
  }, []);

  const closeAnswerShow = useCallback(() => {
    dispatch({ type: 'ANSWER_SHOW_CLOSE' });
  }, []);

  const setCaptureText = useCallback((text: string) => {
    dispatch({ type: 'CAPTURE_TEXT_SET', text });
  }, []);

  const setCaptureTarget = useCallback((target: CaptureTargetChoice) => {
    dispatch({ type: 'CAPTURE_TARGET_SET', target });
  }, []);

  const setCaptureHint = useCallback((hint: string) => {
    dispatch({ type: 'CAPTURE_HINT_SET', hint });
  }, []);

  const capture = useCallback(
    async (text: string, options?: CaptureFilter) => {
      const client = clientRef.current;
      if (!client) return;
      if (text.trim().length === 0) return;
      const requestScopeId = activeScopeIdRef.current;
      dispatch({ type: 'CAPTURE_LOADING' });
      try {
        const result = await client.capture(text, options);
        dispatch({ type: 'CAPTURE_RESULT', result, requestScopeId });
      } catch (e) {
        dispatch({
          type: 'CAPTURE_ERROR',
          error: e instanceof Error ? e.message : String(e),
          requestScopeId,
        });
      }
    },
    [],
  );

  const setRetractTarget = useCallback((target: RetractTarget) => {
    dispatch({ type: 'RETRACT_TARGET_SET', target });
  }, []);

  const setRetractIdentifier = useCallback((identifier: string) => {
    dispatch({ type: 'RETRACT_IDENTIFIER_SET', identifier });
  }, []);

  const setRetractConfirmed = useCallback((confirmed: boolean) => {
    dispatch({ type: 'RETRACT_CONFIRMED_SET', confirmed });
  }, []);

  const retract = useCallback(async (request: RetractRequest) => {
    const client = clientRef.current;
    if (!client) return;
    const requestScopeId = activeScopeIdRef.current;
    dispatch({ type: 'RETRACT_LOADING' });
    try {
      const result = await client.retract(request);
      dispatch({ type: 'RETRACT_RESULT', result, requestScopeId });
    } catch (e) {
      dispatch({
        type: 'RETRACT_ERROR',
        error: e instanceof Error ? e.message : String(e),
        requestScopeId,
      });
    }
  }, []);

  return (
    <DaemonContext.Provider
      value={{
        state,
        ui,
        client: clientRef.current,
        saveSettings,
        setPushNotificationsEnabled,
        setActiveScopeId,
        refresh,
        refreshUi,
        executeUiAction: executeSharedUiAction,
        refreshDigest,
        refreshAttention,
        setKnowledgeQuery,
        searchKnowledge,
        setMemoryQuery,
        searchMemory,
        setHistoryQuery,
        searchHistory,
        setTasksQuery,
        searchTasks,
        setRecallQuery,
        recall,
        setAnswerQuery,
        answer,
        loadAnswerLog,
        loadMoreAnswerLog,
        openAnswerShow,
        closeAnswerShow,
        setCaptureText,
        setCaptureTarget,
        setCaptureHint,
        capture,
        setRetractTarget,
        setRetractIdentifier,
        setRetractConfirmed,
        retract,
      }}
    >
      {children}
    </DaemonContext.Provider>
  );
}

export function useDaemon() {
  return useContext(DaemonContext);
}
