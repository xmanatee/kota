import { type DaemonState, initialState, reducer } from '../context/state';
import type {
  Approval,
  AttentionResponse,
  DaemonStatus,
  DigestResponse,
  OwnerQuestion,
  RunSummary,
  TasksResponse,
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
