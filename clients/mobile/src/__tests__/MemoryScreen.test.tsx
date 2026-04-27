import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { MemoryScreen } from '../screens/MemoryScreen';
import { renderMemorySearchPlain } from '../memoryRender';
import type { MemorySearchResponse } from '../types';

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
    memoryResult: null as MemorySearchResponse | null,
    memoryLoading: false,
    memoryError: null as string | null,
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
}

function mockDaemon(
  overrides: Partial<ReturnType<typeof defaultState>>,
  fns: {
    setMemoryQuery?: jest.Mock;
    searchMemory?: jest.Mock;
  } = {},
) {
  mockUseDaemon.mockReturnValue({
    state: baseState(overrides),
    setMemoryQuery: fns.setMemoryQuery ?? jest.fn(),
    searchMemory: fns.searchMemory ?? jest.fn().mockResolvedValue(undefined),
  });
}

describe('MemoryScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockDaemon({ daemonUrl: '', token: '' });
    const { getByText } = render(<MemoryScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('shows the empty-query usage hint when no query has been entered yet', () => {
    mockDaemon({});
    const { getByText, queryByText } = render(<MemoryScreen />);
    expect(
      getByText('Type a query and tap Search to query memory.'),
    ).toBeTruthy();
    expect(queryByText('No matching memory entries.')).toBeNull();
  });

  test('disables the Search action and skips the request for a whitespace-only query', () => {
    const searchMemory = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ memoryQuery: '   ' }, { searchMemory });
    const { getByText } = render(<MemoryScreen />);
    fireEvent.press(getByText('Search'));
    expect(searchMemory).not.toHaveBeenCalled();
  });

  test('renders populated results with the shared id/date/snippet line shape', () => {
    const result: MemorySearchResponse = {
      ok: true,
      entries: [
        {
          id: 'm-1',
          created: '2026-04-26T12:00:00.000Z',
          content: 'autonomy loop notes',
        },
        {
          id: 'm-22',
          created: '2026-04-25T18:30:00.000Z',
          content: 'old plan\nwith newline',
        },
      ],
    };
    mockDaemon({ memoryQuery: 'autonomy', memoryResult: result });
    const { getByText, queryByText } = render(<MemoryScreen />);
    expect(getByText('2 entries')).toBeTruthy();
    const expected = renderMemorySearchPlain(result.entries);
    expect(getByText(expected)).toBeTruthy();
    expect(expected).toBe(
      'm-1   2026-04-26 12:00  autonomy loop notes\nm-22  2026-04-25 18:30  old plan with newline',
    );
    expect(queryByText('No matching memory entries.')).toBeNull();
  });

  test('renders the singular badge label when exactly one entry is present', () => {
    const result: MemorySearchResponse = {
      ok: true,
      entries: [
        {
          id: 'm-1',
          created: '2026-04-26T12:00:00.000Z',
          content: 'autonomy loop notes',
        },
      ],
    };
    mockDaemon({ memoryQuery: 'autonomy', memoryResult: result });
    const { getByText } = render(<MemoryScreen />);
    expect(getByText('1 entry')).toBeTruthy();
  });

  test('renders the empty-results body and "no matches" badge when the result is empty', () => {
    const result: MemorySearchResponse = { ok: true, entries: [] };
    mockDaemon({ memoryQuery: 'autonomy', memoryResult: result });
    const { getByText } = render(<MemoryScreen />);
    expect(getByText('no matches')).toBeTruthy();
    expect(getByText('No matching memory entries.')).toBeTruthy();
  });

  test('renders the semantic-unavailable explanation explicitly without degrading silently', () => {
    const result: MemorySearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    mockDaemon({ memoryQuery: 'autonomy', memoryResult: result });
    const { getByText, queryByText } = render(<MemoryScreen />);
    expect(getByText('semantic unavailable')).toBeTruthy();
    expect(
      getByText(
        'Semantic memory search requires an embedding-backed memory provider.',
      ),
    ).toBeTruthy();
    expect(queryByText('No matching memory entries.')).toBeNull();
  });

  test('surfaces the daemon HTTP error and offers retry', () => {
    mockDaemon({
      memoryQuery: 'autonomy',
      memoryError: '503 Service Unavailable',
      memoryResult: null,
    });
    const { getByText, queryByText } = render(<MemoryScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('semantic unavailable')).toBeNull();
  });

  test('shows offline banner when daemon is offline', () => {
    mockDaemon({ online: false });
    const { getByText } = render(<MemoryScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('does not auto-fetch on mount when no query has been entered', () => {
    const searchMemory = jest.fn().mockResolvedValue(undefined);
    mockDaemon({}, { searchMemory });
    render(<MemoryScreen />);
    expect(searchMemory).not.toHaveBeenCalled();
  });

  test('Search button calls searchMemory with the trimmed query', () => {
    const searchMemory = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ memoryQuery: '  autonomy  ' }, { searchMemory });
    const { getByText } = render(<MemoryScreen />);
    fireEvent.press(getByText('Search'));
    expect(searchMemory).toHaveBeenCalledWith('autonomy');
  });
});
