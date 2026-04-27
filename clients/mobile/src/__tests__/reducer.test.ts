import { type DaemonState, initialState, reducer } from '../context/state';
import type {
  AnswerResult,
  Approval,
  AttentionResponse,
  DaemonStatus,
  DigestResponse,
  HistorySearchResponse,
  KnowledgeSearchResponse,
  MemorySearchResponse,
  OwnerQuestion,
  RecallSearchResponse,
  RunSummary,
  TasksResponse,
  TasksSearchResponse,
} from '../types';

function makeApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'a1',
    tool: 'shell',
    input: {},
    risk: 'normal',
    createdAt: 't',
    status: 'pending',
    ...overrides,
  };
}

describe('reducer', () => {
  test('SETTINGS_LOADED hydrates persisted config', () => {
    const next = reducer(initialState, {
      type: 'SETTINGS_LOADED',
      url: 'http://host',
      token: 'tok',
      pushEnabled: false,
    });
    expect(next.settingsLoaded).toBe(true);
    expect(next.daemonUrl).toBe('http://host');
    expect(next.token).toBe('tok');
    expect(next.pushNotificationsEnabled).toBe(false);
  });

  test('SET_URL and SET_TOKEN update in isolation', () => {
    let s: DaemonState = initialState;
    s = reducer(s, { type: 'SET_URL', url: 'http://x' });
    expect(s.daemonUrl).toBe('http://x');
    expect(s.token).toBe('');
    s = reducer(s, { type: 'SET_TOKEN', token: 'abc' });
    expect(s.token).toBe('abc');
  });

  test('ONLINE true clears existing error', () => {
    const withError = reducer(initialState, { type: 'ERROR', error: 'boom' });
    expect(withError.error).toBe('boom');
    const online = reducer(withError, { type: 'ONLINE', online: true });
    expect(online.online).toBe(true);
    expect(online.error).toBeNull();
  });

  test('ONLINE false preserves existing error', () => {
    const withError = reducer(initialState, { type: 'ERROR', error: 'boom' });
    const offline = reducer(withError, { type: 'ONLINE', online: false });
    expect(offline.online).toBe(false);
    expect(offline.error).toBe('boom');
  });

  test('APPROVALS recomputes pending count', () => {
    const approvals: Approval[] = [
      makeApproval({ id: 'a1', status: 'pending' }),
      makeApproval({ id: 'a2', status: 'pending' }),
      makeApproval({ id: 'a3', status: 'approved' }),
      makeApproval({ id: 'a4', status: 'rejected' }),
    ];
    const next = reducer(initialState, { type: 'APPROVALS', approvals });
    expect(next.approvals).toHaveLength(4);
    expect(next.pendingApprovalCount).toBe(2);
  });

  test('PENDING_COUNT overrides the derived count without touching approvals', () => {
    const approvals = [makeApproval({ status: 'pending' })];
    const withApprovals = reducer(initialState, { type: 'APPROVALS', approvals });
    expect(withApprovals.pendingApprovalCount).toBe(1);
    const withCount = reducer(withApprovals, { type: 'PENDING_COUNT', count: 42 });
    expect(withCount.pendingApprovalCount).toBe(42);
    expect(withCount.approvals).toHaveLength(1);
  });

  test('STATUS, RUNS, TASKS write through unchanged', () => {
    const status: DaemonStatus = {
      running: true,
      pid: 1,
      startedAt: 't',
      completedRuns: 0,
      workflow: {
        activeRuns: [],
        queueLength: 0,
        completedRuns: 0,
        paused: false,
      },
    };
    const runs: RunSummary[] = [
      { id: 'r1', workflow: 'builder', status: 'success', triggerEvent: 'x', startedAt: 't', durationMs: 1 },
    ];
    const tasks: TasksResponse = { counts: {}, tasks: {} };

    let s = reducer(initialState, { type: 'STATUS', status });
    s = reducer(s, { type: 'RUNS', runs });
    s = reducer(s, { type: 'TASKS', tasks });
    expect(s.status).toBe(status);
    expect(s.runs).toBe(runs);
    expect(s.tasks).toBe(tasks);
  });

  test('SET_PUSH_ENABLED toggles without affecting other fields', () => {
    const s = reducer(initialState, { type: 'SET_PUSH_ENABLED', enabled: false });
    expect(s.pushNotificationsEnabled).toBe(false);
    expect(s.settingsLoaded).toBe(initialState.settingsLoaded);
  });

  test('SSE_STATUS updates the connected flag', () => {
    const s = reducer(initialState, { type: 'SSE_STATUS', connected: true });
    expect(s.sseConnected).toBe(true);
  });

  test('DIGEST_LOADING flips loading flag and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'DIGEST_ERROR',
      error: 'boom',
    });
    expect(withError.digestError).toBe('boom');
    const next = reducer(withError, { type: 'DIGEST_LOADING' });
    expect(next.digestLoading).toBe(true);
    expect(next.digestError).toBeNull();
  });

  test('DIGEST_RESULT stores payload and clears loading/error', () => {
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
        quiet: true,
      },
      text: 'rendered body',
    };
    const loading = reducer(initialState, { type: 'DIGEST_LOADING' });
    const next = reducer(loading, { type: 'DIGEST_RESULT', digest });
    expect(next.digest).toBe(digest);
    expect(next.digestLoading).toBe(false);
    expect(next.digestError).toBeNull();
  });

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
  });

  test('MEMORY_LOADING records the in-flight query and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'MEMORY_ERROR',
      error: 'boom',
    });
    expect(withError.memoryError).toBe('boom');
    const next = reducer(withError, {
      type: 'MEMORY_LOADING',
      query: 'autonomy',
    });
    expect(next.memoryLoading).toBe(true);
    expect(next.memoryError).toBeNull();
    expect(next.memoryQuery).toBe('autonomy');
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
    expect(next.memoryResult).toBe(result);
    expect(next.memoryLoading).toBe(false);
    expect(next.memoryError).toBeNull();
  });

  test('MEMORY_RESULT preserves the semantic-unavailable branch verbatim', () => {
    const result: MemorySearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    const next = reducer(initialState, { type: 'MEMORY_RESULT', result });
    expect(next.memoryResult).toEqual({
      ok: false,
      reason: 'semantic_unavailable',
    });
    expect(next.memoryLoading).toBe(false);
    expect(next.memoryError).toBeNull();
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
    expect(next.memoryResult).toBeNull();
    expect(next.memoryError).toBe('503');
    expect(next.memoryLoading).toBe(false);
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
    expect(withResult.memoryResult).toBe(result);
    const offline = reducer(withResult, { type: 'ONLINE', online: false });
    expect(offline.memoryResult).toBeNull();
  });

  test('HISTORY_QUERY_SET stores the query without touching results or loading flags', () => {
    const next = reducer(initialState, {
      type: 'HISTORY_QUERY_SET',
      query: 'autonomy',
    });
    expect(next.historyQuery).toBe('autonomy');
    expect(next.historyResult).toBeNull();
    expect(next.historyLoading).toBe(false);
    expect(next.historyError).toBeNull();
  });

  test('HISTORY_LOADING records the in-flight query and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'HISTORY_ERROR',
      error: 'boom',
    });
    expect(withError.historyError).toBe('boom');
    const next = reducer(withError, {
      type: 'HISTORY_LOADING',
      query: 'autonomy',
    });
    expect(next.historyLoading).toBe(true);
    expect(next.historyError).toBeNull();
    expect(next.historyQuery).toBe('autonomy');
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
    expect(next.historyResult).toBe(result);
    expect(next.historyLoading).toBe(false);
    expect(next.historyError).toBeNull();
  });

  test('HISTORY_RESULT preserves the semantic-unavailable branch verbatim', () => {
    const result: HistorySearchResponse = {
      ok: false,
      reason: 'semantic_unavailable',
    };
    const next = reducer(initialState, { type: 'HISTORY_RESULT', result });
    expect(next.historyResult).toEqual({
      ok: false,
      reason: 'semantic_unavailable',
    });
    expect(next.historyLoading).toBe(false);
    expect(next.historyError).toBeNull();
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
    expect(next.historyResult).toBeNull();
    expect(next.historyError).toBe('503');
    expect(next.historyLoading).toBe(false);
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
    expect(withResult.historyResult).toBe(result);
    const offline = reducer(withResult, { type: 'ONLINE', online: false });
    expect(offline.historyResult).toBeNull();
  });

  test('TASKS_QUERY_SET stores the query without touching results or loading flags', () => {
    const next = reducer(initialState, {
      type: 'TASKS_QUERY_SET',
      query: 'autonomy',
    });
    expect(next.tasksQuery).toBe('autonomy');
    expect(next.tasksResult).toBeNull();
    expect(next.tasksLoading).toBe(false);
    expect(next.tasksError).toBeNull();
  });

  test('TASKS_LOADING records the in-flight query and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'TASKS_ERROR',
      error: 'boom',
    });
    expect(withError.tasksError).toBe('boom');
    const next = reducer(withError, {
      type: 'TASKS_LOADING',
      query: 'autonomy',
    });
    expect(next.tasksLoading).toBe(true);
    expect(next.tasksError).toBeNull();
    expect(next.tasksQuery).toBe('autonomy');
  });

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
  });

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

  test('OWNER_QUESTIONS recomputes pending count', () => {
    const questions: OwnerQuestion[] = [
      { id: 'q1', context: 'c', question: 'q', reason: 'r', source: 'builder', createdAt: 't', status: 'pending' },
      { id: 'q2', context: 'c', question: 'q', reason: 'r', source: 'builder', createdAt: 't', status: 'pending' },
      { id: 'q3', context: 'c', question: 'q', reason: 'r', source: 'builder', createdAt: 't', status: 'answered' },
      { id: 'q4', context: 'c', question: 'q', reason: 'r', source: 'builder', createdAt: 't', status: 'dismissed' },
    ];
    const next = reducer(initialState, { type: 'OWNER_QUESTIONS', questions });
    expect(next.ownerQuestions).toHaveLength(4);
    expect(next.pendingOwnerQuestionCount).toBe(2);
  });
});
