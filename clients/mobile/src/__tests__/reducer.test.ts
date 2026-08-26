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

  test('IDENTITY seeds activeScopeId on first refresh and ACTIVE_SCOPE clears scoped rows', () => {
    const seeded = reducer(initialState, {
      type: 'IDENTITY',
      identity: {
        scopeName: 'kota',
        scopeRoot: '/tmp/kota',
        daemonVersion: '0.1.0',
        pid: 1,
        startedAt: 't',
        scopeRegistry: {
          rootScopeId: 'global',
          defaultScopeId: 'p-default',
          scopes: [
            { scopeId: 'global', displayName: 'Global' },
            { scopeId: 'p-default', directoryRoot: '/tmp/kota', displayName: 'kota', parentScopeId: 'global' },
            { scopeId: 'p-other', directoryRoot: '/tmp/o', displayName: 'other', parentScopeId: 'global' },
          ],
        },
      },
      activeScopeId: 'p-default',
    });
    expect(seeded.activeScopeId).toBe('p-default');
    expect(seeded.identity?.scopeRegistry.scopes).toHaveLength(3);

    const populated: DaemonState = {
      ...seeded,
      runs: [
        {
          id: 'r1',
          workflow: 'builder',
          status: 'success',
          triggerEvent: 'autonomy.queue.available',
          startedAt: 't',
          durationMs: 1,
        },
      ],
      approvals: [makeApproval()],
      pendingApprovalCount: 1,
    };

    const switched = reducer(populated, {
      type: 'ACTIVE_SCOPE',
      scopeId: 'p-other',
    });
    expect(switched.activeScopeId).toBe('p-other');
    expect(switched.runs).toEqual([]);
    expect(switched.approvals).toEqual([]);
    expect(switched.pendingApprovalCount).toBe(0);

    // Switching back to the same scope is a no-op so React Native does
    // not bounce the StatusScreen list.
    const noop = reducer(switched, { type: 'ACTIVE_SCOPE', scopeId: 'p-other' });
    expect(noop).toBe(switched);
  });

  test('IDENTITY_CLEARED resets identity and activeScopeId together', () => {
    const seeded = reducer(initialState, {
      type: 'IDENTITY',
      identity: {
        scopeName: 'kota',
        scopeRoot: '/tmp/kota',
        daemonVersion: '0.1.0',
        pid: 1,
        startedAt: 't',
        scopeRegistry: {
          rootScopeId: 'global',
          defaultScopeId: 'p-default',
          scopes: [
            { scopeId: 'global', displayName: 'Global' },
            { scopeId: 'p-default', directoryRoot: '/tmp/kota', displayName: 'kota', parentScopeId: 'global' },
          ],
        },
      },
      activeScopeId: 'p-default',
    });
    const cleared = reducer(seeded, { type: 'IDENTITY_CLEARED' });
    expect(cleared.identity).toBeNull();
    expect(cleared.activeScopeId).toBeNull();
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
  });});
