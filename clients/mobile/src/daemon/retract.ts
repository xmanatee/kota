// Cross-store retract types and parser. Mirrors the daemon's
// `RetractTarget` / `RetractRecord` / `RetractRequest` / `RetractResult`
// exported from `src/core/server/kota-client.ts`.

import { daemonRequest, type DaemonHttp } from './http';

export type RetractTarget = 'memory' | 'knowledge' | 'tasks' | 'inbox';

export interface RetractMemoryRecord {
  target: 'memory';
  recordId: string;
}

export interface RetractKnowledgeRecord {
  target: 'knowledge';
  recordId: string;
}

// Tasks-store record dropped by a successful retract. The seam routes
// the task through the existing task-state machine into
// `data/tasks/dropped/`, so the arm carries the previous and resulting
// paths plus the explicit destination state.
export interface RetractTasksRecord {
  target: 'tasks';
  recordId: string;
  previousPath: string;
  path: string;
  toState: 'dropped';
}

export interface RetractInboxRecord {
  target: 'inbox';
  recordId: string;
  path: string;
}

export type RetractRecord =
  | RetractMemoryRecord
  | RetractKnowledgeRecord
  | RetractTasksRecord
  | RetractInboxRecord;

export type RetractRequest =
  | { target: 'memory'; id: string }
  | { target: 'knowledge'; slug: string }
  | { target: 'tasks'; id: string }
  | { target: 'inbox'; path: string };

export type RetractResult =
  | { ok: true; record: RetractRecord }
  | { ok: false; reason: 'no_contributors' }
  | {
      ok: false;
      reason: 'not_found';
      target: RetractTarget;
      identifier: string;
    }
  | {
      ok: false;
      reason: 'contributor_failed';
      target: RetractTarget;
      message: string;
    };

// Stable retract-target ordering. Mirrors the seam's
// `RETRACT_TARGET_ORDER` so the mobile picker option order matches the
// agent, CLI, web, and macOS surfaces.
export const RETRACT_TARGET_ORDER: ReadonlyArray<RetractTarget> = [
  'memory',
  'knowledge',
  'tasks',
  'inbox',
] as const;

const RETRACT_TARGETS: ReadonlyArray<RetractTarget> = RETRACT_TARGET_ORDER;

function parseRetractTarget(value: unknown, context: string): RetractTarget {
  if (
    typeof value !== 'string' ||
    !(RETRACT_TARGETS as readonly string[]).includes(value)
  ) {
    throw new Error(
      `Invalid retract ${context}: unknown target ${String(value)}`,
    );
  }
  return value as RetractTarget;
}

function parseRetractRecord(value: unknown): RetractRecord {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid retract record: not an object');
  }
  const obj = value as Record<string, unknown>;
  const target = parseRetractTarget(obj.target, 'record');
  if (typeof obj.recordId !== 'string') {
    throw new Error('Invalid retract record: recordId missing');
  }
  switch (target) {
    case 'memory':
      return { target: 'memory', recordId: obj.recordId };
    case 'knowledge':
      return { target: 'knowledge', recordId: obj.recordId };
    case 'tasks':
      if (typeof obj.previousPath !== 'string') {
        throw new Error('Invalid retract record: tasks previousPath missing');
      }
      if (typeof obj.path !== 'string') {
        throw new Error('Invalid retract record: tasks path missing');
      }
      if (obj.toState !== 'dropped') {
        throw new Error(
          `Invalid retract record: tasks toState must be "dropped" (got ${String(obj.toState)})`,
        );
      }
      return {
        target: 'tasks',
        recordId: obj.recordId,
        previousPath: obj.previousPath,
        path: obj.path,
        toState: 'dropped',
      };
    case 'inbox':
      if (typeof obj.path !== 'string') {
        throw new Error('Invalid retract record: inbox path missing');
      }
      return { target: 'inbox', recordId: obj.recordId, path: obj.path };
  }
}

// Targets the daemon's `POST /api/retract` user-facing route — the
// same route the embedded web `RetractPanel` consumes — and decodes
// the discriminated four-arm `RetractResult`. The wire shape mirrors
// the daemon's `RetractRequest` discriminated union.
export async function retract(
  http: DaemonHttp,
  request: RetractRequest,
): Promise<RetractResult> {
  const parsed = await daemonRequest<unknown>(http, '/api/retract', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return parseRetractResult(parsed);
}

export function parseRetractResult(value: unknown): RetractResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid retract response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    return { ok: true, record: parseRetractRecord(obj.record) };
  }
  if (obj.ok === false) {
    const reason = obj.reason;
    if (reason === 'no_contributors') {
      return { ok: false, reason: 'no_contributors' };
    }
    if (reason === 'not_found') {
      const target = parseRetractTarget(obj.target, 'not_found');
      if (typeof obj.identifier !== 'string') {
        throw new Error(
          'Invalid retract response: not_found identifier missing',
        );
      }
      return {
        ok: false,
        reason: 'not_found',
        target,
        identifier: obj.identifier,
      };
    }
    if (reason === 'contributor_failed') {
      const target = parseRetractTarget(obj.target, 'contributor_failed');
      if (typeof obj.message !== 'string') {
        throw new Error(
          'Invalid retract response: contributor_failed message missing',
        );
      }
      return {
        ok: false,
        reason: 'contributor_failed',
        target,
        message: obj.message,
      };
    }
    throw new Error(
      `Invalid retract response: unknown reason ${String(reason)}`,
    );
  }
  throw new Error('Invalid retract response: missing ok flag');
}
