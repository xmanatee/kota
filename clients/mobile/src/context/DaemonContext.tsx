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
import type {
  Approval,
  DaemonStatus,
  RunSummary,
  SseEvent,
  TasksResponse,
} from '../types';

const URL_KEY = 'kota_daemon_url';
const TOKEN_KEY = 'kota_daemon_token';

interface DaemonState {
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
  error: string | null;
}

type DaemonAction =
  | { type: 'SETTINGS_LOADED'; url: string; token: string }
  | { type: 'SET_URL'; url: string }
  | { type: 'SET_TOKEN'; token: string }
  | { type: 'ONLINE'; online: boolean }
  | { type: 'SSE_STATUS'; connected: boolean }
  | { type: 'STATUS'; status: DaemonStatus }
  | { type: 'RUNS'; runs: RunSummary[] }
  | { type: 'APPROVALS'; approvals: Approval[] }
  | { type: 'TASKS'; tasks: TasksResponse }
  | { type: 'PENDING_COUNT'; count: number }
  | { type: 'ERROR'; error: string | null };

function reducer(state: DaemonState, action: DaemonAction): DaemonState {
  switch (action.type) {
    case 'SETTINGS_LOADED':
      return { ...state, daemonUrl: action.url, token: action.token, settingsLoaded: true };
    case 'SET_URL':
      return { ...state, daemonUrl: action.url };
    case 'SET_TOKEN':
      return { ...state, token: action.token };
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
    default:
      return state;
  }
}

const initialState: DaemonState = {
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
  error: null,
};

interface DaemonContextValue {
  state: DaemonState;
  client: DaemonClient | null;
  saveSettings: (url: string, token: string) => Promise<void>;
  refresh: () => void;
}

const DaemonContext = createContext<DaemonContextValue>({
  state: initialState,
  client: null,
  saveSettings: async () => {},
  refresh: () => {},
});

export function DaemonProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const clientRef = useRef<DaemonClient | null>(null);
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load persisted settings on mount
  useEffect(() => {
    async function load() {
      const [url, token] = await Promise.all([
        SecureStore.getItemAsync(URL_KEY),
        SecureStore.getItemAsync(TOKEN_KEY),
      ]);
      dispatch({ type: 'SETTINGS_LOADED', url: url ?? '', token: token ?? '' });
    }
    void load();
  }, []);

  // Rebuild client when URL/token changes
  useEffect(() => {
    if (!state.settingsLoaded) return;
    clientRef.current = state.daemonUrl && state.token
      ? new DaemonClient(state.daemonUrl, state.token)
      : null;
  }, [state.daemonUrl, state.token, state.settingsLoaded]);

  const fetchAll = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const [statusRes, runsRes, approvalsRes, tasksRes] = await Promise.all([
        client.getStatus(),
        client.getRuns(undefined, 30),
        client.getApprovals(),
        client.getTasks(),
      ]);
      dispatch({ type: 'STATUS', status: statusRes });
      dispatch({ type: 'RUNS', runs: runsRes.runs });
      dispatch({ type: 'APPROVALS', approvals: approvalsRes.approvals });
      dispatch({ type: 'TASKS', tasks: tasksRes });
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

  const refresh = useCallback(() => {
    void fetchAll();
  }, [fetchAll]);

  return (
    <DaemonContext.Provider value={{ state, client: clientRef.current, saveSettings, refresh }}>
      {children}
    </DaemonContext.Provider>
  );
}

export function useDaemon() {
  return useContext(DaemonContext);
}
