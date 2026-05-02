// Cross-store capture types and parser. Mirrors the daemon's
// `CaptureTarget` / `CaptureRecord` / `CaptureFilter` / `CaptureResult`
// exported from `src/core/server/kota-client.ts`.

import { daemonRequest, type DaemonHttp } from './http';

export type CaptureTarget = 'memory' | 'knowledge' | 'tasks' | 'inbox';

export interface CaptureMemoryRecord {
  target: 'memory';
  recordId: string;
}

export interface CaptureKnowledgeRecord {
  target: 'knowledge';
  recordId: string;
}

export interface CaptureTasksRecord {
  target: 'tasks';
  recordId: string;
  path: string;
}

export interface CaptureInboxRecord {
  target: 'inbox';
  recordId: string;
  path: string;
}

export type CaptureRecord =
  | CaptureMemoryRecord
  | CaptureKnowledgeRecord
  | CaptureTasksRecord
  | CaptureInboxRecord;

export interface CaptureFilter {
  target?: CaptureTarget;
  hint?: string;
}

export type CaptureResult =
  | { ok: true; record: CaptureRecord }
  | {
      ok: false;
      reason: 'ambiguous';
      suggestions: ReadonlyArray<CaptureTarget>;
    }
  | { ok: false; reason: 'no_contributors' }
  | {
      ok: false;
      reason: 'contributor_failed';
      target: CaptureTarget;
      message: string;
    };

// Stable contributor ordering used by the seam to render `suggestions`
// deterministically. The mobile picker mirrors this order so the
// target chip ordering matches what the seam returns and what the web
// `CapturePanel` renders.
export const CAPTURE_TARGET_ORDER: ReadonlyArray<CaptureTarget> = [
  'memory',
  'knowledge',
  'tasks',
  'inbox',
] as const;

const CAPTURE_TARGETS: ReadonlyArray<CaptureTarget> = CAPTURE_TARGET_ORDER;

function parseCaptureTarget(value: unknown, context: string): CaptureTarget {
  if (
    typeof value !== 'string' ||
    !(CAPTURE_TARGETS as readonly string[]).includes(value)
  ) {
    throw new Error(
      `Invalid capture ${context}: unknown target ${String(value)}`,
    );
  }
  return value as CaptureTarget;
}

function parseCaptureRecord(value: unknown): CaptureRecord {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid capture record: not an object');
  }
  const obj = value as Record<string, unknown>;
  const target = parseCaptureTarget(obj.target, 'record');
  if (typeof obj.recordId !== 'string') {
    throw new Error('Invalid capture record: recordId missing');
  }
  switch (target) {
    case 'memory':
      return { target: 'memory', recordId: obj.recordId };
    case 'knowledge':
      return { target: 'knowledge', recordId: obj.recordId };
    case 'tasks':
      if (typeof obj.path !== 'string') {
        throw new Error('Invalid capture record: tasks path missing');
      }
      return { target: 'tasks', recordId: obj.recordId, path: obj.path };
    case 'inbox':
      if (typeof obj.path !== 'string') {
        throw new Error('Invalid capture record: inbox path missing');
      }
      return { target: 'inbox', recordId: obj.recordId, path: obj.path };
  }
}

// Targets the daemon's `POST /api/capture` user-facing route — the
// same route the embedded web `CapturePanel` consumes — and decodes
// the discriminated four-arm `CaptureResult`. The optional per-field
// filter keys (`target`, `hint`) are emitted only when set so the seam
// applies its own typed defaults (classifier picks the target; no hint
// passed). When both are nil, the `filter` key is omitted entirely.
export async function capture(
  http: DaemonHttp,
  text: string,
  options: CaptureFilter = {},
): Promise<CaptureResult> {
  const filter: CaptureFilter = {};
  if (options.target !== undefined) filter.target = options.target;
  if (options.hint !== undefined) filter.hint = options.hint;
  const body: Record<string, unknown> = { text };
  if (Object.keys(filter).length > 0) body.filter = filter;
  const parsed = await daemonRequest<unknown>(http, '/api/capture', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return parseCaptureResult(parsed);
}

export function parseCaptureResult(value: unknown): CaptureResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid capture response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    return { ok: true, record: parseCaptureRecord(obj.record) };
  }
  if (obj.ok === false) {
    const reason = obj.reason;
    if (reason === 'ambiguous') {
      if (!Array.isArray(obj.suggestions)) {
        throw new Error('Invalid capture response: suggestions missing');
      }
      const suggestions = obj.suggestions.map((s) =>
        parseCaptureTarget(s, 'suggestion'),
      );
      return { ok: false, reason: 'ambiguous', suggestions };
    }
    if (reason === 'no_contributors') {
      return { ok: false, reason: 'no_contributors' };
    }
    if (reason === 'contributor_failed') {
      const target = parseCaptureTarget(obj.target, 'failure');
      if (typeof obj.message !== 'string') {
        throw new Error(
          'Invalid capture response: contributor_failed message missing',
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
      `Invalid capture response: unknown reason ${String(reason)}`,
    );
  }
  throw new Error('Invalid capture response: missing ok flag');
}
