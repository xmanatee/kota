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

  test('TASKS_RESULT stores a populated payload and clears loading/error', () => {
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
    const loading = reducer(initialState, {
      type: 'TASKS_LOADING',
      query: 'autonomy',
    });
    const next = reducer(loading, { type: 'TASKS_RESULT', result });
    expect(next.tasksResult).toBe(result);
    expect(next.tasksLoading).toBe(false);
    expect(next.tasksError).toBeNull();
  });

  test('TASKS_RESULT preserves the semantic-unavailable branch verbatim', () => {
    const result: TasksSearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    const next = reducer(initialState, { type: 'TASKS_RESULT', result });
    expect(next.tasksResult).toEqual({
      ok: false,
      reason: 'semantic_unavailable',
    });
    expect(next.tasksLoading).toBe(false);
    expect(next.tasksError).toBeNull();
  });

  test('TASKS_ERROR clears stale tasks result', () => {
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
    const withResult = reducer(initialState, {
      type: 'TASKS_RESULT',
      result,
    });
    const next = reducer(withResult, { type: 'TASKS_ERROR', error: '503' });
    expect(next.tasksResult).toBeNull();
    expect(next.tasksError).toBe('503');
    expect(next.tasksLoading).toBe(false);
  });

  test('ONLINE false drops cached tasks result so it cannot persist across an offline transition', () => {
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
    const withResult = reducer(initialState, {
      type: 'TASKS_RESULT',
      result,
    });
    expect(withResult.tasksResult).toBe(result);
    const offline = reducer(withResult, { type: 'ONLINE', online: false });
    expect(offline.tasksResult).toBeNull();
  });

  test('RECALL_QUERY_SET stores the query without touching results or loading flags', () => {
    const next = reducer(initialState, {
      type: 'RECALL_QUERY_SET',
      query: 'autonomy',
    });
    expect(next.recallQuery).toBe('autonomy');
    expect(next.recallResult).toBeNull();
    expect(next.recallLoading).toBe(false);
    expect(next.recallError).toBeNull();
  });

  test('RECALL_LOADING records the in-flight query and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'RECALL_ERROR',
      error: 'boom',
    });
    expect(withError.recallError).toBe('boom');
    const next = reducer(withError, {
      type: 'RECALL_LOADING',
      query: 'autonomy',
    });
    expect(next.recallLoading).toBe(true);
    expect(next.recallError).toBeNull();
    expect(next.recallQuery).toBe('autonomy');
  });

  test('RECALL_RESULT stores a populated payload across multiple source arms', () => {
    const result: RecallSearchResponse = {
      ok: true,
      hits: [
        {
          source: 'knowledge',
          score: 0.91,
          id: 'k-1',
          title: 'Autonomy loop notes',
          preview: 'cross-store recall seam preview',
          updated: '2026-04-26T12:00:00.000Z',
        },
        {
          source: 'tasks',
          score: 0.71,
          id: 'task-foo',
          title: 'Wire mobile recall',
          state: 'ready',
          priority: 'p2',
          updatedAt: '2026-04-25T12:00:00.000Z',
        },
      ],
    };
    const loading = reducer(initialState, {
      type: 'RECALL_LOADING',
      query: 'autonomy',
    });
    const next = reducer(loading, { type: 'RECALL_RESULT', result });
    expect(next.recallResult).toBe(result);
    expect(next.recallLoading).toBe(false);
    expect(next.recallError).toBeNull();
  });

  test('RECALL_RESULT preserves the semantic-unavailable branch verbatim', () => {
    const result: RecallSearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    const next = reducer(initialState, { type: 'RECALL_RESULT', result });
    expect(next.recallResult).toEqual({
      ok: false,
      reason: 'semantic_unavailable',
    });
    expect(next.recallLoading).toBe(false);
    expect(next.recallError).toBeNull();
  });

  test('RECALL_ERROR clears stale recall result', () => {
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
    const withResult = reducer(initialState, {
      type: 'RECALL_RESULT',
      result,
    });
    const next = reducer(withResult, { type: 'RECALL_ERROR', error: '503' });
    expect(next.recallResult).toBeNull();
    expect(next.recallError).toBe('503');
    expect(next.recallLoading).toBe(false);
  });

  test('ONLINE false drops cached recall result so it cannot persist across an offline transition', () => {
    const result: RecallSearchResponse = {
      ok: true,
      hits: [
        {
          source: 'history',
          score: 0.71,
          id: 'c-1',
          title: 'Autonomy loop debug',
          cwd: '/Users/x/proj',
          updatedAt: '2026-04-25T12:00:00.000Z',
        },
      ],
    };
    const withResult = reducer(initialState, {
      type: 'RECALL_RESULT',
      result,
    });
    expect(withResult.recallResult).toBe(result);
    const offline = reducer(withResult, { type: 'ONLINE', online: false });
    expect(offline.recallResult).toBeNull();
  });

  test('ANSWER_QUERY_SET stores the query without touching results or loading flags', () => {
    const next = reducer(initialState, {
      type: 'ANSWER_QUERY_SET',
      query: 'autonomy loop',
    });
    expect(next.answerQuery).toBe('autonomy loop');
    expect(next.answerResult).toBeNull();
    expect(next.answerLoading).toBe(false);
    expect(next.answerError).toBeNull();
  });});
