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
import type { SseEvent } from '../types';
import { type DaemonState, initialState, reducer } from './state';

const URL_KEY = 'kota_daemon_url';
const TOKEN_KEY = 'kota_daemon_token';
const PUSH_ENABLED_KEY = 'kota_push_notifications_enabled';

interface DaemonContextValue {
  state: DaemonState;
  client: DaemonClient | null;
  saveSettings: (url: string, token: string) => Promise<void>;
  setPushNotificationsEnabled: (enabled: boolean) => Promise<void>;
  refresh: () => void;
  refreshDigest: () => Promise<void>;
  refreshAttention: () => Promise<void>;
}

const DaemonContext = createContext<DaemonContextValue>({
  state: initialState,
  client: null,
  saveSettings: async () => {},
  setPushNotificationsEnabled: async () => {},
  refresh: () => {},
  refreshDigest: async () => {},
  refreshAttention: async () => {},
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

  const fetchAll = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const [statusRes, runsRes, approvalsRes, tasksRes, ownerQuestionsRes] = await Promise.all([
        client.getStatus(),
        client.getRuns(undefined, 30),
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

    switch (event.type) {
      case 'workflow.started':
      case 'workflow.completed':
      case 'queue.changed':
        void client.getStatus().then((s) => dispatch({ type: 'STATUS', status: s }));
        void client.getRuns(undefined, 30).then((r) => dispatch({ type: 'RUNS', runs: r.runs }));
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

  return (
    <DaemonContext.Provider
      value={{
        state,
        client: clientRef.current,
        saveSettings,
        setPushNotificationsEnabled,
        refresh,
        refreshDigest,
        refreshAttention,
      }}
    >
      {children}
    </DaemonContext.Provider>
  );
}

export function useDaemon() {
  return useContext(DaemonContext);
}
