import React from 'react';
import { render } from '@testing-library/react-native';
import { DigestScreen } from '../screens/DigestScreen';
import type { DigestResponse } from '../types';

const mockUseDaemon = jest.fn();

jest.mock('../context/DaemonContext', () => ({
  useDaemon: () => mockUseDaemon(),
}));

function makeDigest(overrides: Partial<DigestResponse['data']> = {}): DigestResponse {
  return {
    data: {
      windowStartedAt: '2026-04-25T08:00:00.000Z',
      windowEndedAt: '2026-04-26T08:00:00.000Z',
      builderCommits: [],
      explorerAdditions: [],
      decomposerSplits: [],
      blockedPromoterMoves: [],
      failedMonitoredRuns: [],
      pendingOwnerQuestions: [],
      agingOperatorCaptures: [],
      queueDelta: {
        current: { backlog: 0, ready: 0, doing: 0, blocked: 0 },
        previous: null,
        delta: { backlog: null, ready: null, doing: null, blocked: null },
      },
      quiet: false,
      ...overrides,
    },
    text: 'Daily digest 2026-04-26\n- builder committed: Add foo',
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
}

function defaultState() {
  return {
    daemonUrl: 'http://host',
    token: 'tok',
    settingsLoaded: true,
    online: true,
    sseConnected: true,
    status: null,
    runs: [],
    approvals: [],
    ownerQuestions: [],
    tasks: null,
    pendingApprovalCount: 0,
    pendingOwnerQuestionCount: 0,
    pushNotificationsEnabled: true,
    error: null,
    digest: null as DigestResponse | null,
    digestLoading: false,
    digestError: null as string | null,
  };
}

describe('DigestScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({ daemonUrl: '', token: '' }),
      refreshDigest: jest.fn(),
    });
    const { getByText } = render(<DigestScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('renders the rendered body and an active label for an active payload', () => {
    const digest = makeDigest({ quiet: false });
    mockUseDaemon.mockReturnValue({
      state: baseState({ digest }),
      refreshDigest: jest.fn(),
    });
    const { getByText, queryByText } = render(<DigestScreen />);
    expect(getByText('Daily Digest')).toBeTruthy();
    expect(getByText('active')).toBeTruthy();
    expect(queryByText('quiet window')).toBeNull();
    expect(getByText(/builder committed: Add foo/)).toBeTruthy();
  });

  test('labels quiet windows distinctly using data.quiet', () => {
    const digest: DigestResponse = {
      ...makeDigest({ quiet: true }),
      text: 'Daily digest 2026-04-26\n(quiet window — nothing to report)',
    };
    mockUseDaemon.mockReturnValue({
      state: baseState({ digest }),
      refreshDigest: jest.fn(),
    });
    const { getByText, queryByText } = render(<DigestScreen />);
    expect(getByText('quiet window')).toBeTruthy();
    expect(queryByText('active')).toBeNull();
    expect(getByText(/quiet window — nothing to report/)).toBeTruthy();
  });

  test('surfaces the daemon HTTP error and offers retry', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({
        digestError: '503 Service Unavailable',
        digest: null,
      }),
      refreshDigest: jest.fn(),
    });
    const { getByText, queryByText } = render(<DigestScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('active')).toBeNull();
    expect(queryByText('quiet window')).toBeNull();
  });

  test('shows offline banner when daemon is offline', () => {
    mockUseDaemon.mockReturnValue({
      state: baseState({ online: false, digest: null }),
      refreshDigest: jest.fn(),
    });
    const { getByText } = render(<DigestScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('triggers a refresh on mount when online and digest is empty', () => {
    const refreshDigest = jest.fn().mockResolvedValue(undefined);
    mockUseDaemon.mockReturnValue({
      state: baseState(),
      refreshDigest,
    });
    render(<DigestScreen />);
    expect(refreshDigest).toHaveBeenCalledTimes(1);
  });

  test('does not auto-refresh when offline', () => {
    const refreshDigest = jest.fn().mockResolvedValue(undefined);
    mockUseDaemon.mockReturnValue({
      state: baseState({ online: false }),
      refreshDigest,
    });
    render(<DigestScreen />);
    expect(refreshDigest).not.toHaveBeenCalled();
  });
});
