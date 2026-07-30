import { type DaemonState, initialState, reducer } from '../context/state';
import type {
  AnswerHistoryEntry,
  AnswerHistoryRecord,
  AnswerResult,
  Approval,
  AttentionResponse,
  CaptureResult,
  DaemonStatus,
  DigestResponse,
  HistorySearchResponse,
  KnowledgeSearchResponse,
  MemorySearchResponse,
  OwnerQuestion,
  RecallSearchResponse,
  RetractResult,
  RunSummary,
  TasksResponse,
  TasksSearchResponse,
} from '../types';

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'a1',
    tool: 'shell',
    input: {},
    review: {
      status: 'available',
      input: {},
      digest: 'a'.repeat(64),
    },
    risk: 'normal',
    createdAt: 't',
    status: 'pending',
    ...overrides,
  };
}

function sampleRecord(overrides: {
  id?: string;
  result: AnswerResult;
}): AnswerHistoryRecord {
  return {
    id: overrides.id ?? '2026-04-26T12-00-00-000Z-aaa',
    createdAt: '2026-04-26T12:00:00.000Z',
    query: 'sample query',
    filter: {},
    recallHits: [],
    result: overrides.result,
  };
}

describe('reducer', () => {

  test('ANSWER_LOADING records the in-flight query and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'ANSWER_ERROR',
      error: 'boom',
    });
    expect(withError.answerError).toBe('boom');
    const next = reducer(withError, {
      type: 'ANSWER_LOADING',
      query: 'autonomy loop',
    });
    expect(next.answerLoading).toBe(true);
    expect(next.answerError).toBeNull();
    expect(next.answerQuery).toBe('autonomy loop');
  });

  test('ANSWER_RESULT stores a synthesized success payload spanning multiple sources', () => {
    const result: AnswerResult = {
      ok: true,
      answer:
        'The recall fan-out indexes [knowledge:k-1] and [memory:m-1] across stores.',
      citations: [
        { source: 'knowledge', id: 'k-1' },
        { source: 'memory', id: 'm-1' },
      ],
      hits: [
        {
          source: 'knowledge',
          score: 0.91,
          id: 'k-1',
          title: 'Cross-store recall fan-out',
          preview: 'preview',
          updated: '2026-04-26T12:00:00.000Z',
        },
        {
          source: 'memory',
          score: 0.83,
          id: 'm-1',
          preview: 'note about recall design',
          created: '2026-04-25T18:30:00.000Z',
        },
      ],
    };
    const loading = reducer(initialState, {
      type: 'ANSWER_LOADING',
      query: 'autonomy loop',
    });
    const next = reducer(loading, { type: 'ANSWER_RESULT', result });
    expect(next.answerResult).toBe(result);
    expect(next.answerLoading).toBe(false);
    expect(next.answerError).toBeNull();
  });

  test('ANSWER_RESULT preserves each ok:false branch verbatim', () => {
    const reasons: Array<Extract<AnswerResult, { ok: false }>['reason']> = [
      'no_hits',
      'semantic_unavailable',
      'synthesis_failed',
    ];
    for (const reason of reasons) {
      const result: AnswerResult = { ok: false, reason };
      const next = reducer(initialState, { type: 'ANSWER_RESULT', result });
      expect(next.answerResult).toEqual({ ok: false, reason });
      expect(next.answerLoading).toBe(false);
      expect(next.answerError).toBeNull();
    }
  });

  test('ANSWER_ERROR clears stale answer result', () => {
    const result: AnswerResult = {
      ok: true,
      answer: 'verbatim answer',
      citations: [{ source: 'knowledge', id: 'k-1' }],
      hits: [
        {
          source: 'knowledge',
          score: 0.91,
          id: 'k-1',
          title: 'Cross-store recall fan-out',
          preview: 'preview',
          updated: '2026-04-26T12:00:00.000Z',
        },
      ],
    };
    const withResult = reducer(initialState, {
      type: 'ANSWER_RESULT',
      result,
    });
    const next = reducer(withResult, { type: 'ANSWER_ERROR', error: '503' });
    expect(next.answerResult).toBeNull();
    expect(next.answerError).toBe('503');
    expect(next.answerLoading).toBe(false);
  });

  test('ONLINE false drops cached answer result so it cannot persist across an offline transition', () => {
    const result: AnswerResult = {
      ok: true,
      answer: 'verbatim answer',
      citations: [],
      hits: [],
    };
    const withResult = reducer(initialState, {
      type: 'ANSWER_RESULT',
      result,
    });
    expect(withResult.answerResult).toBe(result);
    const offline = reducer(withResult, { type: 'ONLINE', online: false });
    expect(offline.answerResult).toBeNull();
  });

  test('initial state seeds the answer-history surface with empty log and no record', () => {
    expect(initialState.answerLogEntries).toEqual([]);
    expect(initialState.answerLogLoading).toBe(false);
    expect(initialState.answerLogError).toBeNull();
    expect(initialState.answerLogHasMore).toBe(false);
    expect(initialState.answerShowRecord).toBeNull();
    expect(initialState.answerShowMissing).toBe(false);
    expect(initialState.answerShowLoading).toBe(false);
    expect(initialState.answerShowError).toBeNull();
  });

  test('ANSWER_LOG_LOADING with reset clears stale entries', () => {
    const seeded: AnswerHistoryEntry[] = [
      {
        id: 'r-1',
        createdAt: 't',
        query: 'q',
        result: { ok: true, citationCount: 1 },
      },
    ];
    const withEntries = reducer(initialState, {
      type: 'ANSWER_LOG_RESULT',
      entries: seeded,
      append: false,
      hasMore: true,
    });
    expect(withEntries.answerLogEntries).toHaveLength(1);
    expect(withEntries.answerLogHasMore).toBe(true);
    const next = reducer(withEntries, {
      type: 'ANSWER_LOG_LOADING',
      reset: true,
    });
    expect(next.answerLogLoading).toBe(true);
    expect(next.answerLogEntries).toEqual([]);
    expect(next.answerLogHasMore).toBe(false);
  });

  test('ANSWER_LOG_LOADING without reset preserves existing entries (append page)', () => {
    const seeded: AnswerHistoryEntry[] = [
      {
        id: 'r-1',
        createdAt: 't1',
        query: 'q1',
        result: { ok: true, citationCount: 1 },
      },
    ];
    const withEntries = reducer(initialState, {
      type: 'ANSWER_LOG_RESULT',
      entries: seeded,
      append: false,
      hasMore: true,
    });
    const next = reducer(withEntries, {
      type: 'ANSWER_LOG_LOADING',
      reset: false,
    });
    expect(next.answerLogLoading).toBe(true);
    expect(next.answerLogEntries).toBe(seeded);
    expect(next.answerLogHasMore).toBe(true);
  });

  test('ANSWER_LOG_RESULT replaces entries by default (reset path)', () => {
    const first: AnswerHistoryEntry[] = [
      {
        id: 'r-1',
        createdAt: 't1',
        query: 'q1',
        result: { ok: true, citationCount: 1 },
      },
    ];
    const replacement: AnswerHistoryEntry[] = [
      {
        id: 'r-2',
        createdAt: 't2',
        query: 'q2',
        result: { ok: false, reason: 'no_hits' },
      },
    ];
    const seeded = reducer(initialState, {
      type: 'ANSWER_LOG_RESULT',
      entries: first,
      append: false,
      hasMore: false,
    });
    const next = reducer(seeded, {
      type: 'ANSWER_LOG_RESULT',
      entries: replacement,
      append: false,
      hasMore: false,
    });
    expect(next.answerLogEntries).toEqual(replacement);
    expect(next.answerLogHasMore).toBe(false);
    expect(next.answerLogLoading).toBe(false);
    expect(next.answerLogError).toBeNull();
  });});
