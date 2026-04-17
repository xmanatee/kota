import { type DaemonState, initialState, reducer } from '../context/state';
import type { Approval, DaemonStatus, OwnerQuestion, RunSummary, TasksResponse } from '../types';

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
