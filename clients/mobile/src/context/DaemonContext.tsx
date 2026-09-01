import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DaemonClient } from '../daemonClient';
import { useSSE } from '../hooks/useSSE';
import { registerPushTokenWithDaemon } from '../pushNotifications';
import { classifyDaemonResourceFailure } from '../resource-state';
import { matchUiEvent, uiLogEntry } from '../shared-ui/live-events';
import type { SseEvent } from '../daemon/sse';
import type {
  UiAction,
  UiActionExecutionResult,
  UiJsonValue,
  UiLogEntry,
  UiSurfaceBundle,
} from '../daemon/ui';
import {
  resourceValue,
  startResource,
  succeedResource,
  type ResourceStart,
  type ResourceState,
} from '../../../shared/resource-state';

const URL_KEY = 'kota_daemon_url';
const TOKEN_KEY = 'kota_daemon_token';
const PUSH_ENABLED_KEY = 'kota_push_notifications_enabled';

type ConnectionState = {
  daemonUrl: string;
  token: string;
  settingsLoaded: boolean;
  online: boolean;
  sseConnected: boolean;
  pushNotificationsEnabled: boolean;
};

export type DaemonState = { connection: ConnectionState };

const initialState: DaemonState = {
  connection: {
    daemonUrl: '',
    token: '',
    settingsLoaded: false,
    online: false,
    sseConnected: false,
    pushNotificationsEnabled: true,
  },
};

export type LiveUiLogEntries = Readonly<Record<string, readonly UiLogEntry[]>>;

export type SharedUiState = {
  resource: ResourceState<UiSurfaceBundle>;
  liveLogEntries: LiveUiLogEntries;
};

const initialSharedUiState: SharedUiState = {
  resource: { status: 'idle' },
  liveLogEntries: {},
};

interface DaemonContextValue {
  state: DaemonState;
  ui: SharedUiState;
  client: DaemonClient | null;
  saveSettings: (url: string, token: string) => Promise<void>;
  setPushNotificationsEnabled: (enabled: boolean) => Promise<void>;
  refreshUi: () => Promise<void>;
  executeUiAction: (
    action: UiAction,
    parameters?: UiJsonValue,
  ) => Promise<UiActionExecutionResult>;
}

const DaemonContext = createContext<DaemonContextValue>({
  state: initialState,
  ui: initialSharedUiState,
  client: null,
  saveSettings: async () => {},
  setPushNotificationsEnabled: async () => {},
  refreshUi: async () => {},
  executeUiAction: async () => ({
    ok: false,
    reason: 'unavailable',
    message: 'Daemon connection is unavailable.',
  }),
});

export function DaemonProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DaemonState>(initialState);
  const [ui, setUi] = useState<SharedUiState>(initialSharedUiState);
  const client = useMemo(
    () =>
      state.connection.daemonUrl && state.connection.token
        ? new DaemonClient(
            state.connection.daemonUrl,
            state.connection.token,
          )
        : null,
    [state.connection.daemonUrl, state.connection.token],
  );
  const uiRef = useRef(ui);
  const uiRequestRef = useRef(0);
  const uiRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushRegisteredRef = useRef(false);

  useEffect(() => {
    uiRef.current = ui;
  }, [ui]);

  useEffect(() => {
    async function loadSettings() {
      const [url, token, pushEnabledRaw] = await Promise.all([
        SecureStore.getItemAsync(URL_KEY),
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(PUSH_ENABLED_KEY),
      ]);
      setState({
        connection: {
          daemonUrl: url ?? '',
          token: token ?? '',
          settingsLoaded: true,
          online: false,
          sseConnected: false,
          pushNotificationsEnabled: pushEnabledRaw !== 'false',
        },
      });
    }
    void loadSettings();
  }, []);

  useEffect(() => {
    uiRequestRef.current += 1;
    setUi(initialSharedUiState);
    pushRegisteredRef.current = false;
  }, [client]);

  const fetchUiSurfaces = useCallback(async (requested?: ResourceStart) => {
    const requestId = ++uiRequestRef.current;
    if (!client) {
      setState((current) => ({
        connection: {
          ...current.connection,
          online: false,
          sseConnected: false,
        },
      }));
      setUi(initialSharedUiState);
      return;
    }
    setUi((current) => ({
      ...current,
      resource: startResource(
        current.resource,
        requested ??
          (resourceValue(current.resource) !== undefined
            ? 'refresh'
            : current.resource.status === 'offline' ||
                current.resource.status === 'recoverable-failure'
              ? 'retry'
              : 'load'),
      ),
    }));
    try {
      const bundle = await client.getUiSurfaces();
      if (requestId !== uiRequestRef.current) return;
      setState((current) => ({
        connection: { ...current.connection, online: true },
      }));
      setUi((current) => ({
        ...current,
        resource: succeedResource(bundle, (value) => value.surfaces.length === 0),
      }));
    } catch (error) {
      if (requestId !== uiRequestRef.current) return;
      const failedResource = classifyDaemonResourceFailure(error);
      setState((current) => ({
        connection: {
          ...current.connection,
          online: failedResource.status !== 'offline',
          sseConnected:
            failedResource.status === 'offline'
              ? false
              : current.connection.sseConnected,
        },
      }));
      setUi({
        ...initialSharedUiState,
        resource: failedResource,
      });
    }
  }, [client]);

  const scheduleUiRefresh = useCallback(() => {
    if (uiRefreshTimerRef.current !== null) return;
    uiRefreshTimerRef.current = setTimeout(() => {
      uiRefreshTimerRef.current = null;
      void fetchUiSurfaces();
    }, 200);
  }, [fetchUiSurfaces]);

  useEffect(
    () => () => {
      if (uiRefreshTimerRef.current !== null) {
        clearTimeout(uiRefreshTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!state.connection.settingsLoaded) return;
    void fetchUiSurfaces();
    const timer = setInterval(() => void fetchUiSurfaces(), 15_000);
    return () => {
      clearInterval(timer);
    };
  }, [fetchUiSurfaces, state.connection.settingsLoaded]);

  useEffect(() => {
    if (
      !state.connection.online ||
      !state.connection.pushNotificationsEnabled ||
      !client ||
      pushRegisteredRef.current
    ) {
      return;
    }
    pushRegisteredRef.current = true;
    void registerPushTokenWithDaemon(client).catch(() => {
      pushRegisteredRef.current = false;
    });
  }, [
    client,
    state.connection.online,
    state.connection.pushNotificationsEnabled,
  ]);

  const handleSseEvent = useCallback(
    (event: SseEvent) => {
      const match = matchUiEvent(
        resourceValue(uiRef.current.resource) ?? null,
        event,
      );
      if (match.refresh) scheduleUiRefresh();
      if (match.streamIds.length === 0) return;

      const entry = uiLogEntry(event);
      setUi((current) => {
        const liveLogEntries = { ...current.liveLogEntries };
        for (const streamId of match.streamIds) {
          liveLogEntries[streamId] = [
            ...(current.liveLogEntries[streamId] ?? []),
            entry,
          ].slice(-100);
        }
        return { ...current, liveLogEntries };
      });
    },
    [scheduleUiRefresh],
  );

  const handleSseStatus = useCallback((connected: boolean) => {
    setState((current) => ({
      connection: { ...current.connection, sseConnected: connected },
    }));
  }, []);

  useSSE(
    state.connection.online && client ? client.sseUrl() : null,
    client?.authHeader ?? null,
    handleSseEvent,
    handleSseStatus,
    (_raw, error) => console.warn(`Malformed daemon event: ${error.message}`),
  );

  const saveSettings = useCallback(async (url: string, token: string) => {
    await Promise.all([
      SecureStore.setItemAsync(URL_KEY, url),
      SecureStore.setItemAsync(TOKEN_KEY, token),
    ]);
    setState((current) => ({
      connection: {
        ...current.connection,
        daemonUrl: url,
        token,
        online: false,
        sseConnected: false,
      },
    }));
  }, []);

  const setPushNotificationsEnabled = useCallback(async (enabled: boolean) => {
    await SecureStore.setItemAsync(PUSH_ENABLED_KEY, enabled ? 'true' : 'false');
    pushRegisteredRef.current = false;
    setState((current) => ({
      connection: {
        ...current.connection,
        pushNotificationsEnabled: enabled,
      },
    }));
  }, []);

  const executeUiAction = useCallback(
    async (action: UiAction, parameters?: UiJsonValue) => {
      if (!client) throw new Error('Daemon connection is unavailable.');
      const result = await client.executeUiAction(action, parameters);
      if (result.ok) await fetchUiSurfaces();
      return result;
    },
    [client, fetchUiSurfaces],
  );

  return (
    <DaemonContext.Provider
      value={{
        state,
        ui,
        client,
        saveSettings,
        setPushNotificationsEnabled,
        refreshUi: fetchUiSurfaces,
        executeUiAction,
      }}
    >
      {children}
    </DaemonContext.Provider>
  );
}

export function useDaemon() {
  return useContext(DaemonContext);
}
