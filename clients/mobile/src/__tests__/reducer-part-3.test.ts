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

  test('MEMORY_LOADING records the in-flight query and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'MEMORY_ERROR',
      error: 'boom',
    });
    expect(withError.content.memoryError).toBe('boom');
    const next = reducer(withError, {
      type: 'MEMORY_LOADING',
      query: 'autonomy',
    });
    expect(next.content.memoryLoading).toBe(true);
    expect(next.content.memoryError).toBeNull();
    expect(next.content.memoryQuery).toBe('autonomy');
  });

  test('MEMORY_RESULT stores a populated payload and clears loading/error', () => {
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
    const loading = reducer(initialState, {
      type: 'MEMORY_LOADING',
      query: 'autonomy',
    });
    const next = reducer(loading, { type: 'MEMORY_RESULT', result });
    expect(next.content.memoryResult).toBe(result);
    expect(next.content.memoryLoading).toBe(false);
    expect(next.content.memoryError).toBeNull();
  });

  test('MEMORY_RESULT preserves the semantic-unavailable branch verbatim', () => {
    const result: MemorySearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    const next = reducer(initialState, { type: 'MEMORY_RESULT', result });
    expect(next.content.memoryResult).toEqual({
      ok: false,
      reason: 'semantic_unavailable',
    });
    expect(next.content.memoryLoading).toBe(false);
    expect(next.content.memoryError).toBeNull();
  });

  test('MEMORY_ERROR clears stale memory result', () => {
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
    const withResult = reducer(initialState, {
      type: 'MEMORY_RESULT',
      result,
    });
    const next = reducer(withResult, { type: 'MEMORY_ERROR', error: '503' });
    expect(next.content.memoryResult).toBeNull();
    expect(next.content.memoryError).toBe('503');
    expect(next.content.memoryLoading).toBe(false);
  });

  test('ONLINE false drops cached memory result so it cannot persist across an offline transition', () => {
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
    const withResult = reducer(initialState, {
      type: 'MEMORY_RESULT',
      result,
    });
    expect(withResult.content.memoryResult).toBe(result);
    const offline = reducer(withResult, { type: 'ONLINE', online: false });
    expect(offline.content.memoryResult).toBeNull();
  });

  test('HISTORY_QUERY_SET stores the query without touching results or loading flags', () => {
    const next = reducer(initialState, {
      type: 'HISTORY_QUERY_SET',
      query: 'autonomy',
    });
    expect(next.content.historyQuery).toBe('autonomy');
    expect(next.content.historyResult).toBeNull();
    expect(next.content.historyLoading).toBe(false);
    expect(next.content.historyError).toBeNull();
  });

  test('HISTORY_LOADING records the in-flight query and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'HISTORY_ERROR',
      error: 'boom',
    });
    expect(withError.content.historyError).toBe('boom');
    const next = reducer(withError, {
      type: 'HISTORY_LOADING',
      query: 'autonomy',
    });
    expect(next.content.historyLoading).toBe(true);
    expect(next.content.historyError).toBeNull();
    expect(next.content.historyQuery).toBe('autonomy');
  });

  test('HISTORY_RESULT stores a populated payload and clears loading/error', () => {
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
    const loading = reducer(initialState, {
      type: 'HISTORY_LOADING',
      query: 'autonomy',
    });
    const next = reducer(loading, { type: 'HISTORY_RESULT', result });
    expect(next.content.historyResult).toBe(result);
    expect(next.content.historyLoading).toBe(false);
    expect(next.content.historyError).toBeNull();
  });

  test('HISTORY_RESULT preserves the semantic-unavailable branch verbatim', () => {
    const result: HistorySearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    const next = reducer(initialState, { type: 'HISTORY_RESULT', result });
    expect(next.content.historyResult).toEqual({
      ok: false,
      reason: 'semantic_unavailable',
    });
    expect(next.content.historyLoading).toBe(false);
    expect(next.content.historyError).toBeNull();
  });

  test('HISTORY_ERROR clears stale history result', () => {
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
    const withResult = reducer(initialState, {
      type: 'HISTORY_RESULT',
      result,
    });
    const next = reducer(withResult, { type: 'HISTORY_ERROR', error: '503' });
    expect(next.content.historyResult).toBeNull();
    expect(next.content.historyError).toBe('503');
    expect(next.content.historyLoading).toBe(false);
  });

  test('ONLINE false drops cached history result so it cannot persist across an offline transition', () => {
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
    const withResult = reducer(initialState, {
      type: 'HISTORY_RESULT',
      result,
    });
    expect(withResult.content.historyResult).toBe(result);
    const offline = reducer(withResult, { type: 'ONLINE', online: false });
    expect(offline.content.historyResult).toBeNull();
  });

  test('TASKS_QUERY_SET stores the query without touching results or loading flags', () => {
    const next = reducer(initialState, {
      type: 'TASKS_QUERY_SET',
      query: 'autonomy',
    });
    expect(next.content.tasksQuery).toBe('autonomy');
    expect(next.content.tasksResult).toBeNull();
    expect(next.content.tasksLoading).toBe(false);
    expect(next.content.tasksError).toBeNull();
  });

  test('TASKS_LOADING records the in-flight query and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'TASKS_ERROR',
      error: 'boom',
    });
    expect(withError.content.tasksError).toBe('boom');
    const next = reducer(withError, {
      type: 'TASKS_LOADING',
      query: 'autonomy',
    });
    expect(next.content.tasksLoading).toBe(true);
    expect(next.content.tasksError).toBeNull();
    expect(next.content.tasksQuery).toBe('autonomy');
  });});
