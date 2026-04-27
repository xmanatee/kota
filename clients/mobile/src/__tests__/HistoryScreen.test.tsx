import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { HistoryScreen } from '../screens/HistoryScreen';
import { renderHistorySearchPlain } from '../historyRender';
import type { HistorySearchResponse } from '../types';

const mockUseDaemon = jest.fn();

jest.mock('../context/DaemonContext', () => ({
  useDaemon: () => mockUseDaemon(),
}));

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
    historyResult: null as HistorySearchResponse | null,
    historyLoading: false,
    historyError: null as string | null,
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
}

function mockDaemon(
  overrides: Partial<ReturnType<typeof defaultState>>,
  fns: {
    setHistoryQuery?: jest.Mock;
    searchHistory?: jest.Mock;
  } = {},
) {
  mockUseDaemon.mockReturnValue({
    state: baseState(overrides),
    setHistoryQuery: fns.setHistoryQuery ?? jest.fn(),
    searchHistory: fns.searchHistory ?? jest.fn().mockResolvedValue(undefined),
  });
}

describe('HistoryScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockDaemon({ daemonUrl: '', token: '' });
    const { getByText } = render(<HistoryScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('shows the empty-query usage hint when no query has been entered yet', () => {
    mockDaemon({});
    const { getByText, queryByText } = render(<HistoryScreen />);
    expect(
      getByText('Type a query and tap Search to query history.'),
    ).toBeTruthy();
    expect(queryByText('No matching conversations.')).toBeNull();
  });

  test('disables the Search action and skips the request for a whitespace-only query', () => {
    const searchHistory = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ historyQuery: '   ' }, { searchHistory });
    const { getByText } = render(<HistoryScreen />);
    fireEvent.press(getByText('Search'));
    expect(searchHistory).not.toHaveBeenCalled();
  });

  test('renders populated results with the shared id/updated/messages/title line shape', () => {
    const result: HistorySearchResponse = {
      ok: true,
      conversations: [
        {
          id: 'c-1',
          title: 'Autonomy loop debug',
          createdAt: '2026-04-26T10:00:00.000Z',
          updatedAt: '2026-04-26T12:00:00.000Z',
          model: 'claude-opus-4-7',
          messageCount: 12,
          cwd: '/Users/x/proj',
        },
        {
          id: 'c-22',
          title: 'Old plan',
          createdAt: '2026-04-25T16:00:00.000Z',
          updatedAt: '2026-04-25T18:30:00.000Z',
          model: 'claude-opus-4-7',
          messageCount: 3,
          cwd: '/Users/x/proj',
        },
      ],
    };
    mockDaemon({ historyQuery: 'autonomy', historyResult: result });
    const { getByText, queryByText } = render(<HistoryScreen />);
    expect(getByText('2 conversations')).toBeTruthy();
    const expected = renderHistorySearchPlain(result.conversations);
    expect(getByText(expected)).toBeTruthy();
    expect(expected).toBe(
      'c-1   2026-04-26 12:00    12 msgs  Autonomy loop debug\n' +
        'c-22  2026-04-25 18:30     3 msgs  Old plan',
    );
    expect(queryByText('No matching conversations.')).toBeNull();
  });

  test('renders the singular badge label when exactly one conversation is present', () => {
    const result: HistorySearchResponse = {
      ok: true,
      conversations: [
        {
          id: 'c-1',
          title: 'Autonomy loop debug',
          createdAt: '2026-04-26T10:00:00.000Z',
          updatedAt: '2026-04-26T12:00:00.000Z',
          model: 'claude-opus-4-7',
          messageCount: 12,
          cwd: '/Users/x/proj',
        },
      ],
    };
    mockDaemon({ historyQuery: 'autonomy', historyResult: result });
    const { getByText } = render(<HistoryScreen />);
    expect(getByText('1 conversation')).toBeTruthy();
  });

  test('renders the empty-results body and "no matches" badge when the result is empty', () => {
    const result: HistorySearchResponse = { ok: true, conversations: [] };
    mockDaemon({ historyQuery: 'autonomy', historyResult: result });
    const { getByText } = render(<HistoryScreen />);
    expect(getByText('no matches')).toBeTruthy();
    expect(getByText('No matching conversations.')).toBeTruthy();
  });

  test('renders the semantic-unavailable explanation explicitly without degrading silently', () => {
    const result: HistorySearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    mockDaemon({ historyQuery: 'autonomy', historyResult: result });
    const { getByText, queryByText } = render(<HistoryScreen />);
    expect(getByText('semantic unavailable')).toBeTruthy();
    expect(
      getByText(
        'Semantic history search requires an embedding-backed history provider.',
      ),
    ).toBeTruthy();
    expect(queryByText('No matching conversations.')).toBeNull();
  });

  test('surfaces the daemon HTTP error and offers retry', () => {
    mockDaemon({
      historyQuery: 'autonomy',
      historyError: '503 Service Unavailable',
      historyResult: null,
    });
    const { getByText, queryByText } = render(<HistoryScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('semantic unavailable')).toBeNull();
  });

  test('shows offline banner when daemon is offline', () => {
    mockDaemon({ online: false });
    const { getByText } = render(<HistoryScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('does not auto-fetch on mount when no query has been entered', () => {
    const searchHistory = jest.fn().mockResolvedValue(undefined);
    mockDaemon({}, { searchHistory });
    render(<HistoryScreen />);
    expect(searchHistory).not.toHaveBeenCalled();
  });

  test('Search button calls searchHistory with the trimmed query', () => {
    const searchHistory = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ historyQuery: '  autonomy  ' }, { searchHistory });
    const { getByText } = render(<HistoryScreen />);
    fireEvent.press(getByText('Search'));
    expect(searchHistory).toHaveBeenCalledWith('autonomy');
  });
});
