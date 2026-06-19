import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import recallRenderFixtureJson from './__fixtures__/recall-render-fixture.json';
import { RecallScreen } from '../screens/RecallScreen';
import {
  describeRecallHit,
  formatRecallScore,
  renderRecallHitsPlain,
} from '../recallRender';
import type { RecallHit, RecallSearchResponse } from '../types';

type RecallRenderFixture = {
  populated: {
    result: Extract<RecallSearchResponse, { ok: true }>;
    descriptions: Record<string, string>;
    scores: Record<string, string>;
    plain: string;
  };
  empty: {
    result: Extract<RecallSearchResponse, { ok: true }>;
    plain: string;
  };
  semanticUnavailable: {
    result: Extract<RecallSearchResponse, { ok: false }>;
  };
};

const recallRenderFixture =
  recallRenderFixtureJson as RecallRenderFixture;

function hitKey(hit: RecallHit): string {
  return `${hit.source}:${hit.id}`;
}

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
    const result: RecallSearchResponse = recallRenderFixture.populated.result;
    mockDaemon({ recallQuery: 'autonomy', recallResult: result });
    const { getAllByText, getByText, queryByText } = render(<RecallScreen />);
    expect(getByText('6 hits')).toBeTruthy();
    for (const hit of result.hits) {
      expect(getAllByText(hit.source).length).toBeGreaterThan(0);
      expect(getByText(formatRecallScore(hit.score))).toBeTruthy();
      expect(getByText(describeRecallHit(hit))).toBeTruthy();
    }
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
    const result: RecallSearchResponse = recallRenderFixture.empty.result;
    mockDaemon({ recallQuery: 'autonomy', recallResult: result });
    const { getByText } = render(<RecallScreen />);
    expect(getByText('no matches')).toBeTruthy();
    expect(getByText('No matching hits.')).toBeTruthy();
  });

  test('renders the semantic-unavailable explanation explicitly without degrading silently', () => {
    const result: RecallSearchResponse =
      recallRenderFixture.semanticUnavailable.result;
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

  test('describeRecallHit + renderRecallHitsPlain consume the shared golden render fixture', () => {
    const result = recallRenderFixture.populated.result;
    for (const hit of result.hits) {
      expect(describeRecallHit(hit)).toBe(
        recallRenderFixture.populated.descriptions[hitKey(hit)],
      );
      expect(formatRecallScore(hit.score)).toBe(
        recallRenderFixture.populated.scores[hitKey(hit)],
      );
    }
    expect(renderRecallHitsPlain(result.hits)).toBe(
      recallRenderFixture.populated.plain,
    );
    expect(renderRecallHitsPlain(recallRenderFixture.empty.result.hits)).toBe(
      recallRenderFixture.empty.plain,
    );
    expect(recallRenderFixture.semanticUnavailable.result).toEqual({
      ok: false,
      reason: 'semantic_unavailable',
    });
  });
});
