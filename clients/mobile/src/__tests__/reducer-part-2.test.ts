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

  test('DIGEST_ERROR clears stale digest', () => {
    const digest: DigestResponse = {
      data: {
        windowStartedAt: 't0',
        windowEndedAt: 't1',
        builderCommits: [],
        explorerAdditions: [],
        decomposerSplits: [],
        blockedPromoterMoves: [],
        failedMonitoredRuns: [],
        pendingOwnerQuestions: [],
        agingOperatorCaptures: [],
        queueDelta: {
          current: { backlog: 0, ready: 0, doing: 0, blocked: 0 },
          previous: null,
          delta: { backlog: null, ready: null, doing: null, blocked: null },
        },
        quiet: false,
      },
      text: 'rendered body',
    };
    const withDigest = reducer(initialState, {
      type: 'DIGEST_RESULT',
      digest,
    });
    const next = reducer(withDigest, { type: 'DIGEST_ERROR', error: '503' });
    expect(next.digest).toBeNull();
    expect(next.digestError).toBe('503');
    expect(next.digestLoading).toBe(false);
  });

  test('ONLINE false drops cached digest so it cannot persist across an offline transition', () => {
    const digest: DigestResponse = {
      data: {
        windowStartedAt: 't0',
        windowEndedAt: 't1',
        builderCommits: [],
        explorerAdditions: [],
        decomposerSplits: [],
        blockedPromoterMoves: [],
        failedMonitoredRuns: [],
        pendingOwnerQuestions: [],
        agingOperatorCaptures: [],
        queueDelta: {
          current: { backlog: 0, ready: 0, doing: 0, blocked: 0 },
          previous: null,
          delta: { backlog: null, ready: null, doing: null, blocked: null },
        },
        quiet: false,
      },
      text: 'rendered body',
    };
    const withDigest = reducer(initialState, {
      type: 'DIGEST_RESULT',
      digest,
    });
    expect(withDigest.digest).toBe(digest);
    const offline = reducer(withDigest, { type: 'ONLINE', online: false });
    expect(offline.digest).toBeNull();
  });

  test('ATTENTION_LOADING flips loading flag and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'ATTENTION_ERROR',
      error: 'boom',
    });
    expect(withError.attentionError).toBe('boom');
    const next = reducer(withError, { type: 'ATTENTION_LOADING' });
    expect(next.attentionLoading).toBe(true);
    expect(next.attentionError).toBeNull();
  });

  test('ATTENTION_RESULT stores payload and clears loading/error', () => {
    const attention: AttentionResponse = {
      data: {
        items: [{ label: 'Owner question', detail: 'pending 2 days' }],
      },
      text: 'Attention required\n- pending owner question',
    };
    const loading = reducer(initialState, { type: 'ATTENTION_LOADING' });
    const next = reducer(loading, { type: 'ATTENTION_RESULT', attention });
    expect(next.attention).toBe(attention);
    expect(next.attentionLoading).toBe(false);
    expect(next.attentionError).toBeNull();
  });

  test('ATTENTION_ERROR clears stale attention payload', () => {
    const attention: AttentionResponse = {
      data: { items: [] },
      text: 'No attention items right now.',
    };
    const withAttention = reducer(initialState, {
      type: 'ATTENTION_RESULT',
      attention,
    });
    const next = reducer(withAttention, {
      type: 'ATTENTION_ERROR',
      error: '503',
    });
    expect(next.attention).toBeNull();
    expect(next.attentionError).toBe('503');
    expect(next.attentionLoading).toBe(false);
  });

  test('ONLINE false drops cached attention so it cannot persist across an offline transition', () => {
    const attention: AttentionResponse = {
      data: { items: [{ label: 'Builder warnings', detail: '3/10' }] },
      text: 'Attention required\n- builder warnings repeating',
    };
    const withAttention = reducer(initialState, {
      type: 'ATTENTION_RESULT',
      attention,
    });
    expect(withAttention.attention).toBe(attention);
    const offline = reducer(withAttention, { type: 'ONLINE', online: false });
    expect(offline.attention).toBeNull();
  });

  test('KNOWLEDGE_QUERY_SET stores the query without touching results or loading flags', () => {
    const next = reducer(initialState, {
      type: 'KNOWLEDGE_QUERY_SET',
      query: 'autonomy',
    });
    expect(next.knowledgeQuery).toBe('autonomy');
    expect(next.knowledgeResult).toBeNull();
    expect(next.knowledgeLoading).toBe(false);
    expect(next.knowledgeError).toBeNull();
  });

  test('KNOWLEDGE_LOADING records the in-flight query and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'KNOWLEDGE_ERROR',
      error: 'boom',
    });
    expect(withError.knowledgeError).toBe('boom');
    const next = reducer(withError, {
      type: 'KNOWLEDGE_LOADING',
      query: 'autonomy',
    });
    expect(next.knowledgeLoading).toBe(true);
    expect(next.knowledgeError).toBeNull();
    expect(next.knowledgeQuery).toBe('autonomy');
  });

  test('KNOWLEDGE_RESULT stores a populated payload and clears loading/error', () => {
    const result: KnowledgeSearchResponse = {
      ok: true,
      entries: [
        { id: 'k-1', type: 'note', status: 'active', title: 'Autonomy loop' },
      ],
    };
    const loading = reducer(initialState, {
      type: 'KNOWLEDGE_LOADING',
      query: 'autonomy',
    });
    const next = reducer(loading, { type: 'KNOWLEDGE_RESULT', result });
    expect(next.knowledgeResult).toBe(result);
    expect(next.knowledgeLoading).toBe(false);
    expect(next.knowledgeError).toBeNull();
  });

  test('KNOWLEDGE_RESULT preserves the semantic-unavailable branch verbatim', () => {
    const result: KnowledgeSearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    const next = reducer(initialState, { type: 'KNOWLEDGE_RESULT', result });
    expect(next.knowledgeResult).toEqual({
      ok: false,
      reason: 'semantic_unavailable',
    });
    expect(next.knowledgeLoading).toBe(false);
    expect(next.knowledgeError).toBeNull();
  });

  test('KNOWLEDGE_ERROR clears stale knowledge result', () => {
    const result: KnowledgeSearchResponse = {
      ok: true,
      entries: [
        { id: 'k-1', type: 'note', status: 'active', title: 'Autonomy loop' },
      ],
    };
    const withResult = reducer(initialState, {
      type: 'KNOWLEDGE_RESULT',
      result,
    });
    const next = reducer(withResult, { type: 'KNOWLEDGE_ERROR', error: '503' });
    expect(next.knowledgeResult).toBeNull();
    expect(next.knowledgeError).toBe('503');
    expect(next.knowledgeLoading).toBe(false);
  });

  test('ONLINE false drops cached knowledge result so it cannot persist across an offline transition', () => {
    const result: KnowledgeSearchResponse = {
      ok: true,
      entries: [
        { id: 'k-1', type: 'note', status: 'active', title: 'Autonomy loop' },
      ],
    };
    const withResult = reducer(initialState, {
      type: 'KNOWLEDGE_RESULT',
      result,
    });
    expect(withResult.knowledgeResult).toBe(result);
    const offline = reducer(withResult, { type: 'ONLINE', online: false });
    expect(offline.knowledgeResult).toBeNull();
  });

  test('MEMORY_QUERY_SET stores the query without touching results or loading flags', () => {
    const next = reducer(initialState, {
      type: 'MEMORY_QUERY_SET',
      query: 'autonomy',
    });
    expect(next.memoryQuery).toBe('autonomy');
    expect(next.memoryResult).toBeNull();
    expect(next.memoryLoading).toBe(false);
    expect(next.memoryError).toBeNull();
  });});
