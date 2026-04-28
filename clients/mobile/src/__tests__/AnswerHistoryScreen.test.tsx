import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AnswerHistoryScreen } from '../screens/AnswerHistoryScreen';
import { describeRecallHit } from '../recallRender';
import type {
  AnswerHistoryEntry,
  AnswerHistoryRecord,
  AnswerResult,
} from '../types';

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
    recallResult: null,
    recallLoading: false,
    recallError: null,
    answerQuery: '',
    answerResult: null as AnswerResult | null,
    answerLoading: false,
    answerError: null as string | null,
    answerLogEntries: [] as AnswerHistoryEntry[],
    answerLogLoading: false,
    answerLogError: null as string | null,
    answerLogHasMore: false,
    answerShowRecord: null as AnswerHistoryRecord | null,
    answerShowMissing: false,
    answerShowLoading: false,
    answerShowError: null as string | null,
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
}

interface MockFns {
  loadAnswerLog?: jest.Mock;
  loadMoreAnswerLog?: jest.Mock;
  openAnswerShow?: jest.Mock;
  closeAnswerShow?: jest.Mock;
}

function mockDaemon(
  overrides: Partial<ReturnType<typeof defaultState>>,
  fns: MockFns = {},
) {
  mockUseDaemon.mockReturnValue({
    state: baseState(overrides),
    loadAnswerLog: fns.loadAnswerLog ?? jest.fn().mockResolvedValue(undefined),
    loadMoreAnswerLog:
      fns.loadMoreAnswerLog ?? jest.fn().mockResolvedValue(undefined),
    openAnswerShow:
      fns.openAnswerShow ?? jest.fn().mockResolvedValue(undefined),
    closeAnswerShow: fns.closeAnswerShow ?? jest.fn(),
  });
}

function knowledgeRecord(
  overrides: { id?: string; createdAt?: string; query?: string } = {},
): AnswerHistoryRecord {
  const result: AnswerResult = {
    ok: true,
    answer:
      'Cross-store recall indexes [knowledge:k-1] and [memory:m-1] across the second brain.',
    citations: [
      { source: 'knowledge', id: 'k-1' },
      { source: 'memory', id: 'm-1' },
    ],
    hits: [
      {
        source: 'knowledge',
        score: 0.912,
        id: 'k-1',
        title: 'Cross-store recall fan-out',
        preview: 'preview',
        updated: '2026-04-26T12:00:00.000Z',
      },
      {
        source: 'memory',
        score: 0.834,
        id: 'm-1',
        preview: 'note about recall design',
        created: '2026-04-25T18:30:00.000Z',
      },
    ],
  };
  return {
    id: overrides.id ?? '2026-04-26T12-00-00-000Z-aaa',
    createdAt: overrides.createdAt ?? '2026-04-26T12:00:00.000Z',
    query: overrides.query ?? 'how does recall fan out',
    filter: {},
    recallHits: result.hits,
    result,
  };
}

function failureRecord(
  reason: 'no_hits' | 'semantic_unavailable' | 'synthesis_failed',
): AnswerHistoryRecord {
  return {
    id: `2026-04-26T11-00-00-000Z-${reason}`,
    createdAt: '2026-04-26T11:00:00.000Z',
    query: `q-${reason}`,
    filter: {},
    recallHits: [],
    result: { ok: false, reason },
  };
}

describe('AnswerHistoryScreen log mode', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockDaemon({ daemonUrl: '', token: '' });
    const { getByText } = render(<AnswerHistoryScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('renders the empty-history fixed message when the log is empty and not loading', () => {
    mockDaemon({});
    const { getByText } = render(<AnswerHistoryScreen />);
    expect(getByText('No answers in history yet.')).toBeTruthy();
  });

  test('auto-loads the log when online and the log is empty', () => {
    const loadAnswerLog = jest.fn().mockResolvedValue(undefined);
    mockDaemon({}, { loadAnswerLog });
    render(<AnswerHistoryScreen />);
    expect(loadAnswerLog).toHaveBeenCalledTimes(1);
  });

  test('skips auto-load when the daemon is offline', () => {
    const loadAnswerLog = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ online: false }, { loadAnswerLog });
    render(<AnswerHistoryScreen />);
    expect(loadAnswerLog).not.toHaveBeenCalled();
  });

  test('shows the offline banner when offline', () => {
    mockDaemon({ online: false });
    const { getByText } = render(<AnswerHistoryScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('renders log rows spanning ok:true and each ok:false reason', () => {
    const entries: AnswerHistoryEntry[] = [
      {
        id: 'r-ok',
        createdAt: '2026-04-26T12:00:00.000Z',
        query: 'how does recall fan out',
        result: { ok: true, citationCount: 2 },
      },
      {
        id: 'r-no-hits',
        createdAt: '2026-04-26T11:00:00.000Z',
        query: 'unanswerable question',
        result: { ok: false, reason: 'no_hits' },
      },
      {
        id: 'r-unavail',
        createdAt: '2026-04-26T10:00:00.000Z',
        query: 'recall down',
        result: { ok: false, reason: 'semantic_unavailable' },
      },
      {
        id: 'r-synth',
        createdAt: '2026-04-26T09:00:00.000Z',
        query: 'synth bad',
        result: { ok: false, reason: 'synthesis_failed' },
      },
    ];
    mockDaemon({ answerLogEntries: entries });
    const { getByText } = render(<AnswerHistoryScreen />);
    expect(getByText('2 cites')).toBeTruthy();
    expect(getByText('no_hits')).toBeTruthy();
    expect(getByText('semantic_unavailable')).toBeTruthy();
    expect(getByText('synthesis_failed')).toBeTruthy();
    expect(getByText('how does recall fan out')).toBeTruthy();
    expect(getByText('unanswerable question')).toBeTruthy();
  });

  test('renders the singular badge label when exactly one citation is present', () => {
    const entries: AnswerHistoryEntry[] = [
      {
        id: 'r-1',
        createdAt: 't',
        query: 'q',
        result: { ok: true, citationCount: 1 },
      },
    ];
    mockDaemon({ answerLogEntries: entries });
    const { getByText } = render(<AnswerHistoryScreen />);
    expect(getByText('1 cite')).toBeTruthy();
  });

  test('clicking a log row opens the show view for that id without re-fetching the list', () => {
    const entries: AnswerHistoryEntry[] = [
      {
        id: 'r-ok',
        createdAt: '2026-04-26T12:00:00.000Z',
        query: 'how does recall fan out',
        result: { ok: true, citationCount: 2 },
      },
    ];
    const openAnswerShow = jest.fn().mockResolvedValue(undefined);
    const loadAnswerLog = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      { answerLogEntries: entries },
      { openAnswerShow, loadAnswerLog },
    );
    const { getByText } = render(<AnswerHistoryScreen />);
    fireEvent.press(getByText('how does recall fan out'));
    expect(openAnswerShow).toHaveBeenCalledWith('r-ok');
    // The list-load effect ran once on mount; the click does not re-fetch.
    expect(loadAnswerLog).toHaveBeenCalledTimes(0);
  });

  test('"Load older" passes beforeId of the last entry through loadMoreAnswerLog', () => {
    const entries: AnswerHistoryEntry[] = [
      {
        id: 'r-1',
        createdAt: 't1',
        query: 'q1',
        result: { ok: true, citationCount: 1 },
      },
      {
        id: 'r-2',
        createdAt: 't2',
        query: 'q2',
        result: { ok: false, reason: 'no_hits' },
      },
    ];
    const loadMoreAnswerLog = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      { answerLogEntries: entries, answerLogHasMore: true },
      { loadMoreAnswerLog },
    );
    const { getByText } = render(<AnswerHistoryScreen />);
    fireEvent.press(getByText('Load older'));
    expect(loadMoreAnswerLog).toHaveBeenCalledTimes(1);
  });

  test('hides "Load older" when there are no more entries to fetch', () => {
    const entries: AnswerHistoryEntry[] = [
      {
        id: 'r-1',
        createdAt: 't1',
        query: 'q1',
        result: { ok: true, citationCount: 1 },
      },
    ];
    mockDaemon({ answerLogEntries: entries, answerLogHasMore: false });
    const { queryByText } = render(<AnswerHistoryScreen />);
    expect(queryByText('Load older')).toBeNull();
  });

  test('surfaces the daemon HTTP error and offers retry', () => {
    mockDaemon({ answerLogError: '503 Service Unavailable' });
    const { getByText } = render(<AnswerHistoryScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });
});

describe('AnswerHistoryScreen show mode', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders the ok:true record verbatim including header, body, and citations across two source arms', () => {
    const record = knowledgeRecord();
    const { getByText } = renderShowFor(record);
    if (record.result.ok !== true) throw new Error('fixture invariant');
    expect(getByText(record.id)).toBeTruthy();
    // The record's createdAt also appears as the log row timestamp, so the
    // record header explicitly carries it again — assert its presence.
    expect(getByText(record.query)).toBeTruthy();
    expect(getByText(record.result.answer)).toBeTruthy();
    expect(getByText('2 cites')).toBeTruthy();
    expect(getByText('knowledge')).toBeTruthy();
    expect(getByText('memory')).toBeTruthy();
    expect(getByText(describeRecallHit(record.result.hits[0]))).toBeTruthy();
    expect(getByText(describeRecallHit(record.result.hits[1]))).toBeTruthy();
  });

  test('renders each ok:false show arm with its fixed notice (no_hits)', () => {
    const record = failureRecord('no_hits');
    const { getByText } = renderShowFor(record);
    expect(getByText('No matching sources for this question.')).toBeTruthy();
    expect(getByText('no hits')).toBeTruthy();
  });

  test('renders each ok:false show arm with its fixed notice (semantic_unavailable)', () => {
    const record = failureRecord('semantic_unavailable');
    const { getByText } = renderShowFor(record);
    expect(
      getByText('Answer unavailable — no recall contributors registered.'),
    ).toBeTruthy();
    expect(getByText('recall unavailable')).toBeTruthy();
  });

  test('renders each ok:false show arm with its fixed notice (synthesis_failed)', () => {
    const record = failureRecord('synthesis_failed');
    const { getByText } = renderShowFor(record);
    expect(
      getByText('Could not compose a cited answer for this question.'),
    ).toBeTruthy();
    expect(getByText('synthesis failed')).toBeTruthy();
  });

  test('renders the missing-id arm with a distinct fixed notice', () => {
    const entries: AnswerHistoryEntry[] = [
      {
        id: 'r-1',
        createdAt: 't',
        query: 'missing-q',
        result: { ok: true, citationCount: 0 },
      },
    ];
    mockDaemon({
      answerLogEntries: entries,
      answerShowMissing: true,
    });
    const { getByText } = render(<AnswerHistoryScreen />);
    fireEvent.press(getByText('missing-q'));
    expect(getByText('No answer record with that id.')).toBeTruthy();
  });

  test('back affordance closes the show view without re-fetching the log', () => {
    const record = knowledgeRecord();
    const entries: AnswerHistoryEntry[] = [
      {
        id: record.id,
        createdAt: record.createdAt,
        query: record.query,
        result: { ok: true, citationCount: 2 },
      },
    ];
    const openAnswerShow = jest.fn().mockResolvedValue(undefined);
    const closeAnswerShow = jest.fn();
    const loadAnswerLog = jest.fn().mockResolvedValue(undefined);
    mockDaemon(
      { answerLogEntries: entries, answerShowRecord: record },
      { openAnswerShow, closeAnswerShow, loadAnswerLog },
    );
    const { getByText } = render(<AnswerHistoryScreen />);
    fireEvent.press(getByText(record.query));
    fireEvent.press(getByText('← Back'));
    expect(closeAnswerShow).toHaveBeenCalledTimes(1);
    // Returning to the log view should not re-fetch — entries are already
    // populated, so the auto-load effect does not fire again.
    expect(loadAnswerLog).toHaveBeenCalledTimes(0);
  });
});

function renderShowFor(record: AnswerHistoryRecord) {
  const entries: AnswerHistoryEntry[] = [
    {
      id: record.id,
      createdAt: record.createdAt,
      query: record.query,
      result: record.result.ok
        ? { ok: true, citationCount: record.result.citations.length }
        : { ok: false, reason: record.result.reason },
    },
  ];
  mockDaemon({
    answerLogEntries: entries,
    answerShowRecord: record,
  });
  const utils = render(<AnswerHistoryScreen />);
  fireEvent.press(utils.getByText(record.query));
  return utils;
}
