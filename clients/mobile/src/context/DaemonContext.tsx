import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
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
} from '../types';
import {
  type CaptureTargetChoice,
  type DaemonState,
  initialState,
  reducer,
} from './state';

const URL_KEY = 'kota_daemon_url';
const TOKEN_KEY = 'kota_daemon_token';
const PUSH_ENABLED_KEY = 'kota_push_notifications_enabled';

interface DaemonContextValue {
  state: DaemonState;
  client: DaemonClient | null;
  saveSettings: (url: string, token: string) => Promise<void>;
  setPushNotificationsEnabled: (enabled: boolean) => Promise<void>;
  setActiveProjectId: (projectId: string) => void;
  refresh: () => void;
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
  client: null,
  saveSettings: async () => {},
  setPushNotificationsEnabled: async () => {},
  setActiveProjectId: () => {},
  refresh: () => {},
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
  const clientRef = useRef<DaemonClient | null>(null);
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pushRegisteredRef = useRef(false);

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
    if (!state.settingsLoaded) return;
    clientRef.current = state.daemonUrl && state.token
      ? new DaemonClient(state.daemonUrl, state.token)
      : null;
    pushRegisteredRef.current = false;
  }, [state.daemonUrl, state.token, state.settingsLoaded]);

  // The reducer owns the active projectId; we mirror it through a ref so
  // the polling loop reads the *latest* selection without re-running on
  // every change. Both `fetchAll` and the SSE handler dispatch updates
  // through this ref so a project switch immediately routes new fetches
  // to the chosen project.
  const activeProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeProjectIdRef.current = state.activeProjectId;
  }, [state.activeProjectId]);

  const fetchAll = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      // Resolve identity first so the registry's default projectId seeds
      // `activeProjectId` before the project-scoped fetches fan out.
      const identity = await client.getIdentity();
      const knownIds = new Set(identity.projects.projects.map((p) => p.projectId));
      const previous = activeProjectIdRef.current;
      const nextProjectId =
        previous && knownIds.has(previous)
          ? previous
          : identity.projects.defaultProjectId;
      dispatch({
        type: 'IDENTITY',
        identity,
        activeProjectId: nextProjectId,
      });
      activeProjectIdRef.current = nextProjectId;

      const [statusRes, runsRes, approvalsRes, tasksRes, ownerQuestionsRes] = await Promise.all([
        client.getStatus(nextProjectId),
        client.getRuns(undefined, 30, nextProjectId),
        client.getApprovals(),
        client.getTasks(),
        client.getOwnerQuestions(),
      ]);
      dispatch({ type: 'STATUS', status: statusRes });
      dispatch({ type: 'RUNS', runs: runsRes.runs });
      dispatch({ type: 'APPROVALS', approvals: approvalsRes.approvals });
      dispatch({ type: 'TASKS', tasks: tasksRes });
      dispatch({ type: 'OWNER_QUESTIONS', questions: ownerQuestionsRes.questions });
      dispatch({ type: 'ERROR', error: null });
    } catch (e) {
      dispatch({ type: 'ERROR', error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Health check loop
  useEffect(() => {
    if (!state.settingsLoaded) return;

    async function checkHealth() {
      const client = clientRef.current;
      if (!client) {
        dispatch({ type: 'ONLINE', online: false });
        return;
      }
      try {
        await client.health();
        dispatch({ type: 'ONLINE', online: true });
        void fetchAll();
      } catch {
        dispatch({ type: 'ONLINE', online: false });
      }
    }

    void checkHealth();
    healthTimerRef.current = setInterval(() => void checkHealth(), 15_000);
    return () => {
      if (healthTimerRef.current !== null) clearInterval(healthTimerRef.current);
    };
  }, [state.settingsLoaded, state.daemonUrl, state.token, fetchAll]);

  // Register push token once when online and push notifications enabled
  useEffect(() => {
    const client = clientRef.current;
    if (!state.online || !client || pushRegisteredRef.current) return;
    if (!state.pushNotificationsEnabled) return;
    pushRegisteredRef.current = true;
    void registerPushTokenWithDaemon(client).catch(() => {
      pushRegisteredRef.current = false;
    });
  }, [state.online, state.pushNotificationsEnabled]);

  // Polling fallback when SSE is not connected
  useEffect(() => {
    if (!state.online || state.sseConnected) {
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
  }, [state.online, state.sseConnected, fetchAll]);

  // SSE event handler
  const handleSseEvent = useCallback((event: SseEvent) => {
    const client = clientRef.current;
    if (!client) return;
    const projectId = activeProjectIdRef.current ?? undefined;

    switch (event.type) {
      case 'workflow.started':
      case 'workflow.completed':
      case 'queue.changed':
        void client
          .getStatus(projectId)
          .then((s) => dispatch({ type: 'STATUS', status: s }));
        void client
          .getRuns(undefined, 30, projectId)
          .then((r) => dispatch({ type: 'RUNS', runs: r.runs }));
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
  }, []);

  const handleSseStatus = useCallback((connected: boolean) => {
    dispatch({ type: 'SSE_STATUS', connected });
  }, []);

  const sseUrl = state.online && clientRef.current
    ? clientRef.current.sseUrl()
    : null;
  const authHeader = clientRef.current?.authHeader ?? null;

  useSSE(sseUrl, authHeader, handleSseEvent, handleSseStatus);

  const saveSettings = useCallback(async (url: string, token: string) => {
    await Promise.all([
      SecureStore.setItemAsync(URL_KEY, url),
      SecureStore.setItemAsync(TOKEN_KEY, token),
    ]);
    dispatch({ type: 'SET_URL', url });
    dispatch({ type: 'SET_TOKEN', token });
  }, []);

  const setActiveProjectId = useCallback((projectId: string) => {
    activeProjectIdRef.current = projectId;
    dispatch({ type: 'ACTIVE_PROJECT', projectId });
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

  const refreshDigest = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    dispatch({ type: 'DIGEST_LOADING' });
    try {
      const digest = await client.getDigest();
      dispatch({ type: 'DIGEST_RESULT', digest });
    } catch (e) {
      dispatch({
        type: 'DIGEST_ERROR',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  const refreshAttention = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    dispatch({ type: 'ATTENTION_LOADING' });
    try {
      const attention = await client.getAttention();
      dispatch({ type: 'ATTENTION_RESULT', attention });
    } catch (e) {
      dispatch({
        type: 'ATTENTION_ERROR',
        error: e instanceof Error ? e.message : String(e),
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
    dispatch({ type: 'KNOWLEDGE_LOADING', query });
    try {
      const result = await client.searchKnowledge(query, 10);
      dispatch({ type: 'KNOWLEDGE_RESULT', result });
    } catch (e) {
      dispatch({
        type: 'KNOWLEDGE_ERROR',
        error: e instanceof Error ? e.message : String(e),
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
    dispatch({ type: 'MEMORY_LOADING', query });
    try {
      const result = await client.searchMemory(query, 10);
      dispatch({ type: 'MEMORY_RESULT', result });
    } catch (e) {
      dispatch({
        type: 'MEMORY_ERROR',
        error: e instanceof Error ? e.message : String(e),
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
    dispatch({ type: 'HISTORY_LOADING', query });
    try {
      const result = await client.searchHistory(query, 10);
      dispatch({ type: 'HISTORY_RESULT', result });
    } catch (e) {
      dispatch({
        type: 'HISTORY_ERROR',
        error: e instanceof Error ? e.message : String(e),
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
    dispatch({ type: 'TASKS_LOADING', query });
    try {
      const result = await client.searchTasks(query, 10);
      dispatch({ type: 'TASKS_RESULT', result });
    } catch (e) {
      dispatch({
        type: 'TASKS_ERROR',
        error: e instanceof Error ? e.message : String(e),
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
    dispatch({ type: 'RECALL_LOADING', query });
    try {
      const result = await client.recall(query);
      dispatch({ type: 'RECALL_RESULT', result });
    } catch (e) {
      dispatch({
        type: 'RECALL_ERROR',
        error: e instanceof Error ? e.message : String(e),
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
    dispatch({ type: 'ANSWER_LOADING', query });
    try {
      const result = await client.answer(query);
      dispatch({ type: 'ANSWER_RESULT', result });
    } catch (e) {
      dispatch({
        type: 'ANSWER_ERROR',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  const ANSWER_LOG_PAGE_SIZE = 20;

  const loadAnswerLog = useCallback(
    async (opts?: AnswerHistoryListFilter) => {
      const client = clientRef.current;
      if (!client) return;
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
        });
      } catch (e) {
        dispatch({
          type: 'ANSWER_LOG_ERROR',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [],
  );

  const loadMoreAnswerLog = useCallback(async () => {
    const last = state.answerLogEntries[state.answerLogEntries.length - 1];
    if (!last) return;
    await loadAnswerLog({ beforeId: last.id });
  }, [state.answerLogEntries, loadAnswerLog]);

  const openAnswerShow = useCallback(async (id: string) => {
    const client = clientRef.current;
    if (!client) return;
    dispatch({ type: 'ANSWER_SHOW_LOADING', id });
    try {
      const result = await client.answerShow(id);
      if (result.ok) {
        dispatch({ type: 'ANSWER_SHOW_RESULT', record: result.record });
      } else {
        dispatch({ type: 'ANSWER_SHOW_NOT_FOUND' });
      }
    } catch (e) {
      dispatch({
        type: 'ANSWER_SHOW_ERROR',
        error: e instanceof Error ? e.message : String(e),
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
      dispatch({ type: 'CAPTURE_LOADING' });
      try {
        const result = await client.capture(text, options);
        dispatch({ type: 'CAPTURE_RESULT', result });
      } catch (e) {
        dispatch({
          type: 'CAPTURE_ERROR',
          error: e instanceof Error ? e.message : String(e),
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
    dispatch({ type: 'RETRACT_LOADING' });
    try {
      const result = await client.retract(request);
      dispatch({ type: 'RETRACT_RESULT', result });
    } catch (e) {
      dispatch({
        type: 'RETRACT_ERROR',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  return (
    <DaemonContext.Provider
      value={{
        state,
        client: clientRef.current,
        saveSettings,
        setPushNotificationsEnabled,
        setActiveProjectId,
        refresh,
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
