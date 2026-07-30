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

  test('initial state seeds the capture surface with the auto picker and no result', () => {
    expect(initialState.captureText).toBe('');
    expect(initialState.captureTarget).toBe('auto');
    expect(initialState.captureHint).toBe('');
    expect(initialState.captureResult).toBeNull();
    expect(initialState.captureLoading).toBe(false);
    expect(initialState.captureError).toBeNull();
  });

  test('CAPTURE_TEXT_SET stores the draft without touching result or loading flags', () => {
    const next = reducer(initialState, {
      type: 'CAPTURE_TEXT_SET',
      text: 'remember the milk',
    });
    expect(next.captureText).toBe('remember the milk');
    expect(next.captureResult).toBeNull();
    expect(next.captureLoading).toBe(false);
    expect(next.captureError).toBeNull();
  });

  test('CAPTURE_TARGET_SET pins each target value through the picker including auto', () => {
    let s: DaemonState = initialState;
    s = reducer(s, { type: 'CAPTURE_TARGET_SET', target: 'tasks' });
    expect(s.captureTarget).toBe('tasks');
    s = reducer(s, { type: 'CAPTURE_TARGET_SET', target: 'inbox' });
    expect(s.captureTarget).toBe('inbox');
    s = reducer(s, { type: 'CAPTURE_TARGET_SET', target: 'auto' });
    expect(s.captureTarget).toBe('auto');
  });

  test('CAPTURE_HINT_SET stores the hint without touching the picker or result', () => {
    const withTarget = reducer(initialState, {
      type: 'CAPTURE_TARGET_SET',
      target: 'memory',
    });
    const withHint = reducer(withTarget, {
      type: 'CAPTURE_HINT_SET',
      hint: 'shopping list',
    });
    expect(withHint.captureHint).toBe('shopping list');
    expect(withHint.captureTarget).toBe('memory');
    expect(withHint.captureResult).toBeNull();
  });

  test('CAPTURE_LOADING flips loading flag and clears prior error', () => {
    const withError = reducer(initialState, {
      type: 'CAPTURE_ERROR',
      error: 'boom',
    });
    expect(withError.captureError).toBe('boom');
    const next = reducer(withError, { type: 'CAPTURE_LOADING' });
    expect(next.captureLoading).toBe(true);
    expect(next.captureError).toBeNull();
  });

  test('CAPTURE_RESULT stores a tasks-arm success payload and clears loading/error', () => {
    const result: CaptureResult = {
      ok: true,
      record: {
        target: 'tasks',
        recordId: 'task-buy-milk',
        path: 'data/tasks/ready/task-buy-milk.md',
      },
    };
    const loading = reducer(initialState, { type: 'CAPTURE_LOADING' });
    const next = reducer(loading, { type: 'CAPTURE_RESULT', result });
    expect(next.captureResult).toBe(result);
    expect(next.captureLoading).toBe(false);
    expect(next.captureError).toBeNull();
  });

  test('CAPTURE_RESULT preserves each ok:false branch verbatim', () => {
    const arms: CaptureResult[] = [
      { ok: false, reason: 'ambiguous', suggestions: ['memory', 'knowledge'] },
      { ok: false, reason: 'no_contributors' },
      {
        ok: false,
        reason: 'contributor_failed',
        target: 'inbox',
        message: 'inbox writer cannot reach project root',
      },
    ];
    for (const result of arms) {
      const next = reducer(initialState, { type: 'CAPTURE_RESULT', result });
      expect(next.captureResult).toEqual(result);
      expect(next.captureLoading).toBe(false);
      expect(next.captureError).toBeNull();
    }
  });

  test('CAPTURE_ERROR clears stale capture result', () => {
    const result: CaptureResult = {
      ok: true,
      record: { target: 'memory', recordId: 'mem-7' },
    };
    const withResult = reducer(initialState, {
      type: 'CAPTURE_RESULT',
      result,
    });
    const next = reducer(withResult, { type: 'CAPTURE_ERROR', error: '503' });
    expect(next.captureResult).toBeNull();
    expect(next.captureError).toBe('503');
    expect(next.captureLoading).toBe(false);
  });

  test('ONLINE false drops cached capture result so it cannot persist across an offline transition', () => {
    const result: CaptureResult = {
      ok: true,
      record: {
        target: 'inbox',
        recordId: 'inbox-1',
        path: 'data/inbox/inbox-1.md',
      },
    };
    const withResult = reducer(initialState, {
      type: 'CAPTURE_RESULT',
      result,
    });
    expect(withResult.captureResult).toBe(result);
    const offline = reducer(withResult, { type: 'ONLINE', online: false });
    expect(offline.captureResult).toBeNull();
    expect(offline.captureLoading).toBe(false);
  });

  test('ONLINE false preserves the captureText draft and the picker selection', () => {
    let s = reducer(initialState, {
      type: 'CAPTURE_TEXT_SET',
      text: 'pending draft',
    });
    s = reducer(s, { type: 'CAPTURE_TARGET_SET', target: 'tasks' });
    s = reducer(s, { type: 'CAPTURE_HINT_SET', hint: 'urgent' });
    const offline = reducer(s, { type: 'ONLINE', online: false });
    expect(offline.captureText).toBe('pending draft');
    expect(offline.captureTarget).toBe('tasks');
    expect(offline.captureHint).toBe('urgent');
  });

  test('initial state seeds the retract surface with memory, empty identifier, no result, no confirmation', () => {
    expect(initialState.retractTarget).toBe('memory');
    expect(initialState.retractIdentifier).toBe('');
    expect(initialState.retractResult).toBeNull();
    expect(initialState.retractLoading).toBe(false);
    expect(initialState.retractError).toBeNull();
    expect(initialState.retractConfirmed).toBe(false);
  });

  test('RETRACT_TARGET_SET clears identifier, result, error, and confirmation when the target actually changes', () => {
    let s = reducer(initialState, {
      type: 'RETRACT_IDENTIFIER_SET',
      identifier: 'mem-7',
    });
    s = reducer(s, { type: 'RETRACT_CONFIRMED_SET', confirmed: true });
    s = reducer(s, {
      type: 'RETRACT_RESULT',
      result: { ok: true, record: { target: 'memory', recordId: 'mem-7' } },
    });
    s = reducer(s, { type: 'RETRACT_ERROR', error: '503' });
    const next = reducer(s, { type: 'RETRACT_TARGET_SET', target: 'inbox' });
    expect(next.retractTarget).toBe('inbox');
    expect(next.retractIdentifier).toBe('');
    expect(next.retractResult).toBeNull();
    expect(next.retractError).toBeNull();
    expect(next.retractConfirmed).toBe(false);
  });

  test('RETRACT_TARGET_SET is a no-op when picking the same target (preserves identifier draft)', () => {
    const seeded = reducer(initialState, {
      type: 'RETRACT_IDENTIFIER_SET',
      identifier: 'mem-7',
    });
    const same = reducer(seeded, {
      type: 'RETRACT_TARGET_SET',
      target: 'memory',
    });
    expect(same.retractIdentifier).toBe('mem-7');
    expect(same).toBe(seeded);
  });

  test('RETRACT_IDENTIFIER_SET clears confirmation but preserves target', () => {
    let s = reducer(initialState, {
      type: 'RETRACT_TARGET_SET',
      target: 'tasks',
    });
    s = reducer(s, {
      type: 'RETRACT_IDENTIFIER_SET',
      identifier: 'task-foo',
    });
    s = reducer(s, { type: 'RETRACT_CONFIRMED_SET', confirmed: true });
    expect(s.retractConfirmed).toBe(true);
    const next = reducer(s, {
      type: 'RETRACT_IDENTIFIER_SET',
      identifier: 'task-bar',
    });
    expect(next.retractIdentifier).toBe('task-bar');
    expect(next.retractTarget).toBe('tasks');
    expect(next.retractConfirmed).toBe(false);
  });

  test('RETRACT_LOADING flips loading flag, clears prior result/error, and resets confirmation', () => {
    let s = reducer(initialState, { type: 'RETRACT_ERROR', error: 'boom' });
    s = reducer(s, { type: 'RETRACT_CONFIRMED_SET', confirmed: true });
    const next = reducer(s, { type: 'RETRACT_LOADING' });
    expect(next.retractLoading).toBe(true);
    expect(next.retractError).toBeNull();
    expect(next.retractResult).toBeNull();
    expect(next.retractConfirmed).toBe(false);
  });});
