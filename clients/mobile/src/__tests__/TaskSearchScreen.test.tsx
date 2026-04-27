import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TaskSearchScreen } from '../screens/TaskSearchScreen';
import { renderRepoTaskSearchPlain } from '../tasksRender';
import type { TasksSearchResponse } from '../types';

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
    historyResult: null,
    historyLoading: false,
    historyError: null,
    tasksQuery: '',
    tasksResult: null as TasksSearchResponse | null,
    tasksLoading: false,
    tasksError: null as string | null,
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
}

function mockDaemon(
  overrides: Partial<ReturnType<typeof defaultState>>,
  fns: {
    setTasksQuery?: jest.Mock;
    searchTasks?: jest.Mock;
  } = {},
) {
  mockUseDaemon.mockReturnValue({
    state: baseState(overrides),
    setTasksQuery: fns.setTasksQuery ?? jest.fn(),
    searchTasks: fns.searchTasks ?? jest.fn().mockResolvedValue(undefined),
  });
}

describe('TaskSearchScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockDaemon({ daemonUrl: '', token: '' });
    const { getByText } = render(<TaskSearchScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('shows the empty-query usage hint when no query has been entered yet', () => {
    mockDaemon({});
    const { getByText, queryByText } = render(<TaskSearchScreen />);
    expect(
      getByText('Type a query and tap Search to query tasks.'),
    ).toBeTruthy();
    expect(queryByText('No matching tasks.')).toBeNull();
  });

  test('disables the Search action and skips the request for a whitespace-only query', () => {
    const searchTasks = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ tasksQuery: '   ' }, { searchTasks });
    const { getByText } = render(<TaskSearchScreen />);
    fireEvent.press(getByText('Search'));
    expect(searchTasks).not.toHaveBeenCalled();
  });

  test('renders populated results with the shared id/state/priority/title line shape', () => {
    const result: TasksSearchResponse = {
      ok: true,
      tasks: [
        {
          id: 't-1',
          title: 'Foo',
          state: 'ready',
          priority: 'p2',
          area: 'client',
          summary: 'Foo task summary',
          updatedAt: '2026-04-27T06:30:52.806Z',
          score: 0.91,
        },
        {
          id: 't-22',
          title: 'Bar',
          state: 'doing',
          priority: 'p3',
          area: 'core',
          summary: 'Bar task summary',
          updatedAt: '2026-04-25T18:30:00.000Z',
          score: 0.42,
        },
      ],
    };
    mockDaemon({ tasksQuery: 'task search', tasksResult: result });
    const { getByText, queryByText } = render(<TaskSearchScreen />);
    expect(getByText('2 tasks')).toBeTruthy();
    const expected = renderRepoTaskSearchPlain(result.tasks);
    expect(getByText(expected)).toBeTruthy();
    expect(expected).toBe(
      't-1   ready  p2    Foo\n' + 't-22  doing  p3    Bar',
    );
    expect(queryByText('No matching tasks.')).toBeNull();
  });

  test('renders the singular badge label when exactly one task is present', () => {
    const result: TasksSearchResponse = {
      ok: true,
      tasks: [
        {
          id: 'task-foo',
          title: 'Add foo',
          state: 'ready',
          priority: 'p2',
          area: 'client',
          summary: 'Add foo to the surface',
          updatedAt: '2026-04-26T12:00:00.000Z',
          score: 0.91,
        },
      ],
    };
    mockDaemon({ tasksQuery: 'foo', tasksResult: result });
    const { getByText } = render(<TaskSearchScreen />);
    expect(getByText('1 task')).toBeTruthy();
  });

  test('renders the empty-results body and "no matches" badge when the result is empty', () => {
    const result: TasksSearchResponse = { ok: true, tasks: [] };
    mockDaemon({ tasksQuery: 'autonomy', tasksResult: result });
    const { getByText } = render(<TaskSearchScreen />);
    expect(getByText('no matches')).toBeTruthy();
    expect(getByText('No matching tasks.')).toBeTruthy();
  });

  test('renders the semantic-unavailable explanation explicitly without degrading silently', () => {
    const result: TasksSearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    mockDaemon({ tasksQuery: 'autonomy', tasksResult: result });
    const { getByText, queryByText } = render(<TaskSearchScreen />);
    expect(getByText('semantic unavailable')).toBeTruthy();
    expect(
      getByText(
        'Semantic task search requires an embedding-backed repo-tasks provider.',
      ),
    ).toBeTruthy();
    expect(queryByText('No matching tasks.')).toBeNull();
  });

  test('surfaces the daemon HTTP error and offers retry', () => {
    mockDaemon({
      tasksQuery: 'autonomy',
      tasksError: '503 Service Unavailable',
      tasksResult: null,
    });
    const { getByText, queryByText } = render(<TaskSearchScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('semantic unavailable')).toBeNull();
  });

  test('shows offline banner when daemon is offline', () => {
    mockDaemon({ online: false });
    const { getByText } = render(<TaskSearchScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('does not auto-fetch on mount when no query has been entered', () => {
    const searchTasks = jest.fn().mockResolvedValue(undefined);
    mockDaemon({}, { searchTasks });
    render(<TaskSearchScreen />);
    expect(searchTasks).not.toHaveBeenCalled();
  });

  test('Search button calls searchTasks with the trimmed query', () => {
    const searchTasks = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ tasksQuery: '  autonomy  ' }, { searchTasks });
    const { getByText } = render(<TaskSearchScreen />);
    fireEvent.press(getByText('Search'));
    expect(searchTasks).toHaveBeenCalledWith('autonomy');
  });
});
