import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RecallScreen } from '../screens/RecallScreen';
import { describeRecallHit, renderRecallHitsPlain } from '../recallRender';
import type { RecallSearchResponse } from '../types';

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
    tasksResult: null,
    tasksLoading: false,
    tasksError: null,
    recallQuery: '',
    recallResult: null as RecallSearchResponse | null,
    recallLoading: false,
    recallError: null as string | null,
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
}

function mockDaemon(
  overrides: Partial<ReturnType<typeof defaultState>>,
  fns: {
    setRecallQuery?: jest.Mock;
    recall?: jest.Mock;
  } = {},
) {
  mockUseDaemon.mockReturnValue({
    state: baseState(overrides),
    setRecallQuery: fns.setRecallQuery ?? jest.fn(),
    recall: fns.recall ?? jest.fn().mockResolvedValue(undefined),
  });
}

describe('RecallScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockDaemon({ daemonUrl: '', token: '' });
    const { getByText } = render(<RecallScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('shows the empty-query usage hint when no query has been entered yet', () => {
    mockDaemon({});
    const { getByText, queryByText } = render(<RecallScreen />);
    expect(
      getByText(
        'Type a query and tap Search to recall across knowledge, memory, history, tasks, and answer.',
      ),
    ).toBeTruthy();
    expect(queryByText('No matching hits.')).toBeNull();
  });

  test('rendered DOM of the empty-query pane matches the committed snapshot fixture', () => {
    // Per `data/tasks/AGENTS.md`, mobile (React Native) accepts a rendered
    // DOM fixture as the operator-cosmetic acceptance artifact. The
    // snapshot file in `__snapshots__/RecallScreen.test.tsx.snap` is that
    // fixture: a serialized render tree of the empty-query pane the
    // operator sees on first paint, including the five-source hint text.
    mockDaemon({});
    const { toJSON } = render(<RecallScreen />);
    expect(toJSON()).toMatchSnapshot();
  });

  test('disables the Search action and skips the request for a whitespace-only query', () => {
    const recall = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ recallQuery: '   ' }, { recall });
    const { getByText } = render(<RecallScreen />);
    fireEvent.press(getByText('Search'));
    expect(recall).not.toHaveBeenCalled();
  });

  test('renders populated results across multiple source arms with per-row badges and scores', () => {
    const result: RecallSearchResponse = {
      ok: true,
      hits: [
        {
          source: 'knowledge',
          score: 0.912,
          id: 'k-1',
          title: 'Autonomy loop notes',
          preview: 'cross-store recall seam preview',
          updated: '2026-04-26T12:00:00.000Z',
        },
        {
          source: 'tasks',
          score: 0.713,
          id: 'task-foo',
          title: 'Wire mobile recall',
          state: 'ready',
          priority: 'p2',
          updatedAt: '2026-04-25T12:00:00.000Z',
        },
      ],
    };
    mockDaemon({ recallQuery: 'autonomy', recallResult: result });
    const { getByText, queryByText } = render(<RecallScreen />);
    expect(getByText('2 hits')).toBeTruthy();
    expect(getByText('knowledge')).toBeTruthy();
    expect(getByText('tasks')).toBeTruthy();
    expect(getByText('0.912')).toBeTruthy();
    expect(getByText('0.713')).toBeTruthy();
    expect(getByText(describeRecallHit(result.hits[0]))).toBeTruthy();
    expect(getByText(describeRecallHit(result.hits[1]))).toBeTruthy();
    expect(queryByText('No matching hits.')).toBeNull();
  });

  test('renders the singular badge label when exactly one hit is present', () => {
    const result: RecallSearchResponse = {
      ok: true,
      hits: [
        {
          source: 'memory',
          score: 0.83,
          id: 'm-1',
          preview: 'remembers the recall fan-out cadence',
          created: '2026-04-25T18:30:00.000Z',
        },
      ],
    };
    mockDaemon({ recallQuery: 'autonomy', recallResult: result });
    const { getByText } = render(<RecallScreen />);
    expect(getByText('1 hit')).toBeTruthy();
  });

  test('renders the empty-results body and "no matches" badge when the result is empty', () => {
    const result: RecallSearchResponse = { ok: true, hits: [] };
    mockDaemon({ recallQuery: 'autonomy', recallResult: result });
    const { getByText } = render(<RecallScreen />);
    expect(getByText('no matches')).toBeTruthy();
    expect(getByText('No matching hits.')).toBeTruthy();
  });

  test('renders the semantic-unavailable explanation explicitly without degrading silently', () => {
    const result: RecallSearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    mockDaemon({ recallQuery: 'autonomy', recallResult: result });
    const { getByText, queryByText } = render(<RecallScreen />);
    expect(getByText('semantic unavailable')).toBeTruthy();
    expect(
      getByText('Recall unavailable — no embedding-backed contributors registered.'),
    ).toBeTruthy();
    expect(queryByText('No matching hits.')).toBeNull();
  });

  test('surfaces the daemon HTTP error and offers retry', () => {
    mockDaemon({
      recallQuery: 'autonomy',
      recallError: '503 Service Unavailable',
      recallResult: null,
    });
    const { getByText, queryByText } = render(<RecallScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('semantic unavailable')).toBeNull();
  });

  test('shows offline banner when daemon is offline', () => {
    mockDaemon({ online: false });
    const { getByText } = render(<RecallScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('does not auto-fetch on mount when no query has been entered', () => {
    const recall = jest.fn().mockResolvedValue(undefined);
    mockDaemon({}, { recall });
    render(<RecallScreen />);
    expect(recall).not.toHaveBeenCalled();
  });

  test('Search button calls recall with the trimmed query', () => {
    const recall = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ recallQuery: '  autonomy  ' }, { recall });
    const { getByText } = render(<RecallScreen />);
    fireEvent.press(getByText('Search'));
    expect(recall).toHaveBeenCalledWith('autonomy');
  });

  test('describeRecallHit + renderRecallHitsPlain produce the same line shape as src/modules/recall/render.ts', () => {
    const result: RecallSearchResponse = {
      ok: true,
      hits: [
        {
          source: 'knowledge',
          score: 0.912,
          id: 'k-1',
          title: 'Autonomy loop notes',
          preview: 'cross-store recall seam preview',
          updated: '2026-04-26T12:00:00.000Z',
        },
        {
          source: 'memory',
          score: 0.834,
          id: 'm-1',
          preview: 'remembers the recall fan-out cadence',
          created: '2026-04-25T18:30:00.000Z',
        },
        {
          source: 'history',
          score: 0.712,
          id: 'c-1',
          title: 'Autonomy loop debug',
          cwd: '/Users/x/proj',
          updatedAt: '2026-04-25T12:00:00.000Z',
        },
        {
          source: 'tasks',
          score: 0.633,
          id: 'task-foo',
          title: 'Wire mobile recall',
          state: 'ready',
          priority: 'p2',
          updatedAt: '2026-04-24T12:00:00.000Z',
        },
      ],
    };
    expect(renderRecallHitsPlain(result.hits)).toBe(
      'knowledge  0.912  k-1       Autonomy loop notes\n' +
        'memory     0.834  m-1       remembers the recall fan-out cadence\n' +
        'history    0.712  c-1       Autonomy loop debug\n' +
        'tasks      0.633  task-foo  [ready/p2] Wire mobile recall',
    );
  });
});
