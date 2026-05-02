// Cross-store recall types and parser. Mirrors the daemon's
// `RecallSource` / `RecallHit` / `RecallSearchResponse` exported from
// `src/core/server/kota-client.ts`. The wire shape is a discriminated
// union over `source`; the per-source payload carries the operator-
// facing metadata each surface renders.

import { daemonRequest, type DaemonHttp } from './http';

export type RecallSource = 'knowledge' | 'memory' | 'history' | 'tasks';

export interface RecallKnowledgeHit {
  source: 'knowledge';
  score: number;
  id: string;
  title: string;
  preview: string;
  updated: string;
}

export interface RecallMemoryHit {
  source: 'memory';
  score: number;
  id: string;
  preview: string;
  created: string;
}

export interface RecallHistoryHit {
  source: 'history';
  score: number;
  id: string;
  title: string;
  cwd: string;
  updatedAt: string;
}

export interface RecallTasksHit {
  source: 'tasks';
  score: number;
  id: string;
  title: string;
  state: string;
  priority: string;
  updatedAt: string;
}

export type RecallHit =
  | RecallKnowledgeHit
  | RecallMemoryHit
  | RecallHistoryHit
  | RecallTasksHit;

export type RecallSearchResponse =
  | { ok: true; hits: RecallHit[] }
  | { ok: false; reason: 'semantic_unavailable' };

// Optional filter accepted by `DaemonClient.recall`. All fields are
// optional with explicit defaults applied at the daemon seam (`topK`
// defaults to 20, `minScore` defaults to 0, `sources` defaults to every
// registered contributor).
export interface RecallFilter {
  topK?: number;
  minScore?: number;
  sources?: ReadonlyArray<RecallSource>;
}

// Targets the daemon's `POST /api/recall` user-facing route — the same
// route the embedded web `RecallPanel` consumes — and decodes the
// discriminated success / `semantic_unavailable` envelope. The optional
// `filter` field is only sent when at least one of `topK` / `minScore`
// / `sources` is set, so the daemon seam applies its typed defaults
// (`RECALL_DEFAULT_TOP_K = 20`, no min-score floor, every registered
// contributor).
export async function recall(
  http: DaemonHttp,
  query: string,
  options: RecallFilter = {},
): Promise<RecallSearchResponse> {
  const filter: RecallFilter = {};
  if (options.topK !== undefined) filter.topK = options.topK;
  if (options.minScore !== undefined) filter.minScore = options.minScore;
  if (options.sources !== undefined) filter.sources = options.sources;
  const body: Record<string, unknown> = { query };
  if (Object.keys(filter).length > 0) body.filter = filter;
  const parsed = await daemonRequest<unknown>(http, '/api/recall', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return parseRecallSearchResponse(parsed);
}

export function parseRecallSearchResponse(value: unknown): RecallSearchResponse {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid recall response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (!Array.isArray(obj.hits)) {
      throw new Error('Invalid recall response: hits missing');
    }
    const hits = obj.hits.map(parseRecallHit);
    return { ok: true, hits };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'semantic_unavailable') {
      throw new Error(
        `Invalid recall response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'semantic_unavailable' };
  }
  throw new Error('Invalid recall response: missing ok flag');
}

export function parseRecallHit(value: unknown): RecallHit {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid recall hit');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.source !== 'string' ||
    typeof obj.score !== 'number' ||
    typeof obj.id !== 'string'
  ) {
    throw new Error('Invalid recall hit: missing required fields');
  }
  switch (obj.source) {
    case 'knowledge':
      if (
        typeof obj.title !== 'string' ||
        typeof obj.preview !== 'string' ||
        typeof obj.updated !== 'string'
      ) {
        throw new Error('Invalid recall hit: missing knowledge fields');
      }
      return {
        source: 'knowledge',
        score: obj.score,
        id: obj.id,
        title: obj.title,
        preview: obj.preview,
        updated: obj.updated,
      };
    case 'memory':
      if (
        typeof obj.preview !== 'string' ||
        typeof obj.created !== 'string'
      ) {
        throw new Error('Invalid recall hit: missing memory fields');
      }
      return {
        source: 'memory',
        score: obj.score,
        id: obj.id,
        preview: obj.preview,
        created: obj.created,
      };
    case 'history':
      if (
        typeof obj.title !== 'string' ||
        typeof obj.cwd !== 'string' ||
        typeof obj.updatedAt !== 'string'
      ) {
        throw new Error('Invalid recall hit: missing history fields');
      }
      return {
        source: 'history',
        score: obj.score,
        id: obj.id,
        title: obj.title,
        cwd: obj.cwd,
        updatedAt: obj.updatedAt,
      };
    case 'tasks':
      if (
        typeof obj.title !== 'string' ||
        typeof obj.state !== 'string' ||
        typeof obj.priority !== 'string' ||
        typeof obj.updatedAt !== 'string'
      ) {
        throw new Error('Invalid recall hit: missing tasks fields');
      }
      return {
        source: 'tasks',
        score: obj.score,
        id: obj.id,
        title: obj.title,
        state: obj.state,
        priority: obj.priority,
        updatedAt: obj.updatedAt,
      };
    default:
      throw new Error(`Invalid recall hit: unknown source ${String(obj.source)}`);
  }
}
