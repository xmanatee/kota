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

  test('ANSWER_LOG_RESULT with append concatenates the next page', () => {
    const first: AnswerHistoryEntry[] = [
      {
        id: 'r-1',
        createdAt: 't1',
        query: 'q1',
        result: { ok: true, citationCount: 1 },
      },
    ];
    const second: AnswerHistoryEntry[] = [
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
      hasMore: true,
    });
    const next = reducer(seeded, {
      type: 'ANSWER_LOG_RESULT',
      entries: second,
      append: true,
      hasMore: false,
    });
    expect(next.content.answerLogEntries.map((e) => e.id)).toEqual(['r-1', 'r-2']);
    expect(next.content.answerLogHasMore).toBe(false);
  });

  test('ANSWER_LOG_ERROR records the error without dropping accumulated entries', () => {
    const first: AnswerHistoryEntry[] = [
      {
        id: 'r-1',
        createdAt: 't1',
        query: 'q1',
        result: { ok: true, citationCount: 1 },
      },
    ];
    const seeded = reducer(initialState, {
      type: 'ANSWER_LOG_RESULT',
      entries: first,
      append: false,
      hasMore: false,
    });
    const next = reducer(seeded, {
      type: 'ANSWER_LOG_ERROR',
      error: '503',
    });
    expect(next.content.answerLogError).toBe('503');
    expect(next.content.answerLogLoading).toBe(false);
    expect(next.content.answerLogEntries).toEqual(first);
  });

  test('ANSWER_SHOW_LOADING clears prior record and missing flag', () => {
    const record = sampleRecord({
      id: 'r-1',
      result: {
        ok: true,
        answer: 'verbatim [knowledge:k-1]',
        citations: [{ source: 'knowledge', id: 'k-1' }],
        hits: [
          {
            source: 'knowledge',
            score: 0.91,
            id: 'k-1',
            title: 'title',
            preview: 'preview',
            updated: 't',
          },
        ],
      },
    });
    const seeded = reducer(initialState, {
      type: 'ANSWER_SHOW_RESULT',
      record,
    });
    expect(seeded.content.answerShowRecord).toBe(record);
    const next = reducer(seeded, {
      type: 'ANSWER_SHOW_LOADING',
      id: 'r-2',
    });
    expect(next.content.answerShowLoading).toBe(true);
    expect(next.content.answerShowRecord).toBeNull();
    expect(next.content.answerShowMissing).toBe(false);
    expect(next.content.answerShowError).toBeNull();
  });

  test('ANSWER_SHOW_RESULT preserves the four AnswerResult arms verbatim', () => {
    const records: AnswerHistoryRecord[] = [
      sampleRecord({
        id: 'r-ok',
        result: {
          ok: true,
          answer: 'verbatim [knowledge:k-1]',
          citations: [{ source: 'knowledge', id: 'k-1' }],
          hits: [
            {
              source: 'knowledge',
              score: 0.91,
              id: 'k-1',
              title: 'title',
              preview: 'preview',
              updated: 't',
            },
          ],
        },
      }),
      sampleRecord({
        id: 'r-no-hits',
        result: { ok: false, reason: 'no_hits' },
      }),
      sampleRecord({
        id: 'r-unavail',
        result: { ok: false, reason: 'semantic_unavailable' },
      }),
      sampleRecord({
        id: 'r-synth',
        result: { ok: false, reason: 'synthesis_failed' },
      }),
    ];
    for (const record of records) {
      const next = reducer(initialState, {
        type: 'ANSWER_SHOW_RESULT',
        record,
      });
      expect(next.content.answerShowRecord).toBe(record);
      expect(next.content.answerShowMissing).toBe(false);
      expect(next.content.answerShowLoading).toBe(false);
      expect(next.content.answerShowError).toBeNull();
    }
  });

  test('ANSWER_SHOW_NOT_FOUND surfaces the missing-id arm without a record', () => {
    const next = reducer(initialState, { type: 'ANSWER_SHOW_NOT_FOUND' });
    expect(next.content.answerShowMissing).toBe(true);
    expect(next.content.answerShowRecord).toBeNull();
    expect(next.content.answerShowLoading).toBe(false);
    expect(next.content.answerShowError).toBeNull();
  });

  test('ANSWER_SHOW_ERROR clears stale record and missing flag', () => {
    const record = sampleRecord({
      id: 'r-1',
      result: {
        ok: true,
        answer: 'a',
        citations: [],
        hits: [],
      },
    });
    const seeded = reducer(initialState, {
      type: 'ANSWER_SHOW_RESULT',
      record,
    });
    const next = reducer(seeded, {
      type: 'ANSWER_SHOW_ERROR',
      error: '503',
    });
    expect(next.content.answerShowError).toBe('503');
    expect(next.content.answerShowLoading).toBe(false);
    expect(next.content.answerShowRecord).toBeNull();
    expect(next.content.answerShowMissing).toBe(false);
  });

  test('ANSWER_SHOW_CLOSE clears the show view back to idle', () => {
    const record = sampleRecord({
      id: 'r-1',
      result: {
        ok: true,
        answer: 'a',
        citations: [],
        hits: [],
      },
    });
    const seeded = reducer(initialState, {
      type: 'ANSWER_SHOW_RESULT',
      record,
    });
    const next = reducer(seeded, { type: 'ANSWER_SHOW_CLOSE' });
    expect(next.content.answerShowRecord).toBeNull();
    expect(next.content.answerShowMissing).toBe(false);
    expect(next.content.answerShowLoading).toBe(false);
    expect(next.content.answerShowError).toBeNull();
  });

  test('ONLINE false drops cached answer-log entries and answer-show record', () => {
    const record = sampleRecord({
      id: 'r-1',
      result: {
        ok: true,
        answer: 'a',
        citations: [],
        hits: [],
      },
    });
    let s = reducer(initialState, {
      type: 'ANSWER_LOG_RESULT',
      entries: [
        {
          id: 'r-1',
          createdAt: 't',
          query: 'q',
          result: { ok: true, citationCount: 0 },
        },
      ],
      append: false,
      hasMore: true,
    });
    s = reducer(s, { type: 'ANSWER_SHOW_RESULT', record });
    s = reducer(s, { type: 'ONLINE', online: false });
    expect(s.content.answerLogEntries).toEqual([]);
    expect(s.content.answerLogHasMore).toBe(false);
    expect(s.content.answerShowRecord).toBeNull();
    expect(s.content.answerShowMissing).toBe(false);
  });});
