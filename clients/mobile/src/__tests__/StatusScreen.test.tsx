import React from 'react';
import { render } from '@testing-library/react-native';
import { StatusScreen } from '../screens/StatusScreen';
import type { DaemonStatus } from '../types';

const mockUseDaemon = jest.fn();

jest.mock('../context/DaemonContext', () => ({
  useDaemon: () => mockUseDaemon(),
}));

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
}

function defaultState() {
  const status: DaemonStatus = {
    running: true,
    pid: 1,
    startedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    completedRuns: 0,
    workflow: {
      activeRuns: [
        { runId: 'aaaaaaaaXX', workflow: 'builder', startedAt: new Date(Date.now() - 30_000).toISOString() },
      ],
      queueLength: 2,
      completedRuns: 0,
      paused: false,
    },
  };
  return {
    daemonUrl: 'http://host',
    token: 'tok',
    settingsLoaded: true,
    online: true,
    sseConnected: true,
    status,
    runs: [],
    approvals: [],
    tasks: null,
    pendingApprovalCount: 0,
    pushNotificationsEnabled: true,
    error: null,
  };
}

describe('StatusScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({ daemonUrl: '', token: '' }),
      client: null,
      refresh: jest.fn(),
    });
    const { getByText } = render(
      <StatusScreen onRunPress={jest.fn()} onSettingsPress={jest.fn()} />,
    );
    expect(getByText('No daemon configured.')).toBeTruthy();
    expect(getByText('Open Settings')).toBeTruthy();
  });

  test('renders running status and an active run card when online', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState(),
      client: {
        pauseDispatch: jest.fn(),
        resumeDispatch: jest.fn(),
      },
      refresh: jest.fn(),
    });
    const { getByText, queryByText } = render(
      <StatusScreen onRunPress={jest.fn()} onSettingsPress={jest.fn()} />,
    );
    expect(getByText('Daemon: Running')).toBeTruthy();
    expect(getByText('Active Runs (1)')).toBeTruthy();
    expect(getByText('builder')).toBeTruthy();
    expect(queryByText('No active runs.')).toBeNull();
    expect(getByText('2 pending')).toBeTruthy();
    expect(getByText('⏸  Pause Dispatch')).toBeTruthy();
  });

  test('renders offline banner and hides pause button when offline', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({ online: false, sseConnected: false }),
      client: null,
      refresh: jest.fn(),
    });
    const { getByText, queryByText } = render(
      <StatusScreen onRunPress={jest.fn()} onSettingsPress={jest.fn()} />,
    );
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
    expect(getByText('Daemon: Offline')).toBeTruthy();
    expect(queryByText('⏸  Pause Dispatch')).toBeNull();
  });

  test('shows SSE fallback banner when online but SSE disconnected', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({ sseConnected: false }),
      client: {},
      refresh: jest.fn(),
    });
    const { getByText } = render(
      <StatusScreen onRunPress={jest.fn()} onSettingsPress={jest.fn()} />,
    );
    expect(getByText('Live updates unavailable — polling every 10s')).toBeTruthy();
  });
});
