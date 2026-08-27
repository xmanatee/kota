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

  test('RETRACT_RESULT preserves each ok:false branch verbatim alongside the ok success arms', () => {
    const arms: RetractResult[] = [
      {
        ok: true,
        record: {
          target: 'tasks',
          recordId: 'task-foo',
          previousPath: 'data/tasks/task-foo.md',
          path: 'data/tasks/archive/task-foo.md',
          toState: 'dropped',
        },
      },
      { ok: false, reason: 'no_contributors' },
      {
        ok: false,
        reason: 'not_found',
        target: 'knowledge',
        identifier: 'unknown-slug',
      },
      {
        ok: false,
        reason: 'contributor_failed',
        target: 'inbox',
        message: 'inbox writer cannot reach scope root',
      },
    ];
    for (const result of arms) {
      const next = reducer(initialState, { type: 'RETRACT_RESULT', result });
      expect(next.content.retractResult).toEqual(result);
      expect(next.content.retractLoading).toBe(false);
      expect(next.content.retractError).toBeNull();
    }
  });

  test('RETRACT_ERROR clears stale retract result', () => {
    const result: RetractResult = {
      ok: true,
      record: { target: 'memory', recordId: 'mem-7' },
    };
    const withResult = reducer(initialState, {
      type: 'RETRACT_RESULT',
      result,
    });
    const next = reducer(withResult, { type: 'RETRACT_ERROR', error: '503' });
    expect(next.content.retractResult).toBeNull();
    expect(next.content.retractError).toBe('503');
    expect(next.content.retractLoading).toBe(false);
  });

  test('ONLINE false drops cached retract result/error/loading/confirmation but preserves target+identifier draft', () => {
    let s: DaemonState = reducer(initialState, {
      type: 'RETRACT_TARGET_SET',
      target: 'tasks',
    });
    s = reducer(s, {
      type: 'RETRACT_IDENTIFIER_SET',
      identifier: 'task-foo',
    });
    s = reducer(s, { type: 'RETRACT_CONFIRMED_SET', confirmed: true });
    s = reducer(s, {
      type: 'RETRACT_RESULT',
      result: {
        ok: true,
        record: {
          target: 'tasks',
          recordId: 'task-foo',
          previousPath: 'data/tasks/task-foo.md',
          path: 'data/tasks/archive/task-foo.md',
          toState: 'dropped',
        },
      },
    });
    const offline = reducer(s, { type: 'ONLINE', online: false });
    expect(offline.content.retractResult).toBeNull();
    expect(offline.content.retractError).toBeNull();
    expect(offline.content.retractLoading).toBe(false);
    expect(offline.content.retractConfirmed).toBe(false);
    expect(offline.content.retractTarget).toBe('tasks');
    expect(offline.content.retractIdentifier).toBe('task-foo');
  });});
