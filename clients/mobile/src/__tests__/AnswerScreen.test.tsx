import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AnswerScreen } from '../screens/AnswerScreen';
import { describeRecallHit } from '../recallRender';
import type { AnswerResult } from '../types';

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
  };
}

function baseState(overrides: Partial<ReturnType<typeof defaultState>> = {}) {
  return { ...defaultState(), ...overrides };
}

function mockDaemon(
  overrides: Partial<ReturnType<typeof defaultState>>,
  fns: {
    setAnswerQuery?: jest.Mock;
    answer?: jest.Mock;
  } = {},
) {
  mockUseDaemon.mockReturnValue({
    state: baseState(overrides),
    setAnswerQuery: fns.setAnswerQuery ?? jest.fn(),
    answer: fns.answer ?? jest.fn().mockResolvedValue(undefined),
  });
}

describe('AnswerScreen', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('renders "No daemon configured." when settings are loaded but URL/token missing', () => {
    mockDaemon({ daemonUrl: '', token: '' });
    const { getByText } = render(<AnswerScreen />);
    expect(getByText('No daemon configured.')).toBeTruthy();
  });

  test('shows the empty-query usage hint when no question has been entered yet', () => {
    mockDaemon({});
    const { getByText, queryByText } = render(<AnswerScreen />);
    expect(
      getByText(
        'Type a question and tap Ask to compose a cited answer across knowledge, memory, history, and tasks.',
      ),
    ).toBeTruthy();
    expect(queryByText('No matching sources for this question.')).toBeNull();
  });

  test('disables Ask and skips the request for a whitespace-only query', () => {
    const answer = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ answerQuery: '   ' }, { answer });
    const { getByText } = render(<AnswerScreen />);
    fireEvent.press(getByText('Ask'));
    expect(answer).not.toHaveBeenCalled();
  });

  test('Ask button calls answer with the trimmed query', () => {
    const answer = jest.fn().mockResolvedValue(undefined);
    mockDaemon({ answerQuery: '  recall fan-out  ' }, { answer });
    const { getByText } = render(<AnswerScreen />);
    fireEvent.press(getByText('Ask'));
    expect(answer).toHaveBeenCalledWith('recall fan-out');
  });

  test('renders the synthesized success body verbatim with citations across two source arms', () => {
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
    mockDaemon({ answerQuery: 'how does recall fan out', answerResult: result });
    const { getByText } = render(<AnswerScreen />);
    expect(getByText(result.answer)).toBeTruthy();
    expect(getByText('2 cites')).toBeTruthy();
    expect(getByText('knowledge')).toBeTruthy();
    expect(getByText('memory')).toBeTruthy();
    expect(getByText('0.912')).toBeTruthy();
    expect(getByText('0.834')).toBeTruthy();
    expect(getByText(describeRecallHit(result.hits[0]))).toBeTruthy();
    expect(getByText(describeRecallHit(result.hits[1]))).toBeTruthy();
  });

  test('renders the singular badge label when exactly one citation is present', () => {
    const result: AnswerResult = {
      ok: true,
      answer: 'Single citation answer [tasks:task-foo].',
      citations: [{ source: 'tasks', id: 'task-foo' }],
      hits: [
        {
          source: 'tasks',
          score: 0.71,
          id: 'task-foo',
          title: 'Wire mobile answer',
          state: 'ready',
          priority: 'p2',
          updatedAt: '2026-04-25T12:00:00.000Z',
        },
      ],
    };
    mockDaemon({ answerQuery: 'q', answerResult: result });
    const { getByText } = render(<AnswerScreen />);
    expect(getByText('1 cite')).toBeTruthy();
  });

  test('renders the answered badge when the success arm carries no citations', () => {
    const result: AnswerResult = {
      ok: true,
      answer: 'Answer with no citations.',
      citations: [],
      hits: [],
    };
    mockDaemon({ answerQuery: 'q', answerResult: result });
    const { getByText } = render(<AnswerScreen />);
    expect(getByText('answered')).toBeTruthy();
  });

  test('renders the no_hits notice explicitly without degrading silently', () => {
    const result: AnswerResult = { ok: false, reason: 'no_hits' };
    mockDaemon({ answerQuery: 'q', answerResult: result });
    const { getByText, queryByText } = render(<AnswerScreen />);
    expect(getByText('no hits')).toBeTruthy();
    expect(getByText('No matching sources for this question.')).toBeTruthy();
    expect(queryByText('answered')).toBeNull();
  });

  test('renders the semantic_unavailable notice explicitly', () => {
    const result: AnswerResult = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    mockDaemon({ answerQuery: 'q', answerResult: result });
    const { getByText } = render(<AnswerScreen />);
    expect(getByText('recall unavailable')).toBeTruthy();
    expect(
      getByText('Answer unavailable — no recall contributors registered.'),
    ).toBeTruthy();
  });

  test('renders the synthesis_failed notice explicitly without throwing', () => {
    const result: AnswerResult = {
      ok: false,
      reason: 'synthesis_failed',
    };
    mockDaemon({ answerQuery: 'q', answerResult: result });
    const { getByText } = render(<AnswerScreen />);
    expect(getByText('synthesis failed')).toBeTruthy();
    expect(
      getByText('Could not compose a cited answer for this question.'),
    ).toBeTruthy();
  });

  test('surfaces the daemon HTTP error and offers retry', () => {
    mockDaemon({
      answerQuery: 'recall',
      answerError: '503 Service Unavailable',
      answerResult: null,
    });
    const { getByText, queryByText } = render(<AnswerScreen />);
    expect(getByText('503 Service Unavailable')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    expect(queryByText('synthesis failed')).toBeNull();
  });

  test('shows offline banner when daemon is offline', () => {
    mockDaemon({ online: false });
    const { getByText } = render(<AnswerScreen />);
    expect(getByText('Daemon offline — retrying every 15s')).toBeTruthy();
  });

  test('does not auto-fetch on mount when no query has been entered', () => {
    const answer = jest.fn().mockResolvedValue(undefined);
    mockDaemon({}, { answer });
    render(<AnswerScreen />);
    expect(answer).not.toHaveBeenCalled();
  });
});
