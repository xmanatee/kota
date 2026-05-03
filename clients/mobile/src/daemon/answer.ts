// Cited-answer types and parsers. Mirrors the daemon's `AnswerCitation`
// / `AnswerResult` / `AnswerHistory*` exported from
// `src/core/server/kota-client.ts`.

import { daemonRequest, type DaemonHttp } from './http';
import type { RecallSource, RecallHit, RecallFilter } from './recall';
import { parseRecallHit } from './recall';

export interface AnswerCitation {
  source: RecallSource;
  id: string;
}

export type AnswerFilter = RecallFilter;

export type AnswerResult =
  | {
      ok: true;
      answer: string;
      citations: AnswerCitation[];
      hits: RecallHit[];
    }
  | {
      ok: false;
      reason: 'no_hits' | 'semantic_unavailable' | 'synthesis_failed';
    };

export interface AnswerHistoryRecord {
  id: string;
  createdAt: string;
  query: string;
  filter: AnswerFilter;
  recallHits: RecallHit[];
  result: AnswerResult;
}

export interface AnswerHistoryEntry {
  id: string;
  createdAt: string;
  query: string;
  result:
    | { ok: true; citationCount: number }
    | {
        ok: false;
        reason: 'no_hits' | 'semantic_unavailable' | 'synthesis_failed';
      };
}

export interface AnswerHistoryListFilter {
  limit?: number;
  beforeId?: string;
}

export interface AnswerHistoryListResult {
  entries: AnswerHistoryEntry[];
}

export type AnswerHistoryShowResult =
  | { ok: true; record: AnswerHistoryRecord }
  | { ok: false; reason: 'not_found' };

const ANSWER_REASONS: ReadonlyArray<
  'no_hits' | 'semantic_unavailable' | 'synthesis_failed'
> = ['no_hits', 'semantic_unavailable', 'synthesis_failed'];

const ANSWER_CITATION_SOURCES: ReadonlyArray<RecallSource> = [
  'knowledge',
  'memory',
  'history',
  'tasks',
  'answer',
];

// Targets the daemon's `POST /api/answer` user-facing route — the same
// route the embedded web `AnswerPanel` and Telegram `/answer` consume
// — and decodes the discriminated four-arm `AnswerResult`. The
// optional `filter` field is only sent when at least one of `topK` /
// `minScore` / `sources` is set, so the daemon seam applies its typed
// defaults.
export async function answer(
  http: DaemonHttp,
  query: string,
  options: AnswerFilter = {},
): Promise<AnswerResult> {
  const filter: AnswerFilter = {};
  if (options.topK !== undefined) filter.topK = options.topK;
  if (options.minScore !== undefined) filter.minScore = options.minScore;
  if (options.sources !== undefined) filter.sources = options.sources;
  const body: Record<string, unknown> = { query };
  if (Object.keys(filter).length > 0) body.filter = filter;
  const parsed = await daemonRequest<unknown>(http, '/api/answer', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return parseAnswerResult(parsed);
}

// Targets the daemon's `GET /api/answers` route — the same route the
// web `AnswerHistoryPanel`, the Slack `/answer-log` reply, the
// Telegram `/answer-log` reply, and the `kota answer log` CLI all
// consume — and decodes the typed `AnswerHistoryListResult`. The
// optional `beforeId` cursor and `limit` are emitted as query params
// only when set so the daemon store applies its own typed defaults.
export async function answerLog(
  http: DaemonHttp,
  filter: AnswerHistoryListFilter = {},
): Promise<AnswerHistoryListResult> {
  const params = new URLSearchParams();
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.beforeId !== undefined) params.set('beforeId', filter.beforeId);
  const qs = params.toString();
  const parsed = await daemonRequest<unknown>(
    http,
    `/api/answers${qs ? `?${qs}` : ''}`,
  );
  return parseAnswerHistoryListResult(parsed);
}

// Targets the daemon's `GET /api/answers/:id` route and decodes the
// discriminated `AnswerHistoryShowResult`.
export async function answerShow(
  http: DaemonHttp,
  id: string,
): Promise<AnswerHistoryShowResult> {
  const parsed = await daemonRequest<unknown>(
    http,
    `/api/answers/${encodeURIComponent(id)}`,
  );
  return parseAnswerHistoryShowResult(parsed);
}

export function parseAnswerResult(value: unknown): AnswerResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (typeof obj.answer !== 'string') {
      throw new Error('Invalid answer response: answer missing');
    }
    if (!Array.isArray(obj.citations)) {
      throw new Error('Invalid answer response: citations missing');
    }
    if (!Array.isArray(obj.hits)) {
      throw new Error('Invalid answer response: hits missing');
    }
    const citations = obj.citations.map(parseAnswerCitation);
    const hits = obj.hits.map(parseRecallHit);
    return { ok: true, answer: obj.answer, citations, hits };
  }
  if (obj.ok === false) {
    const reason = obj.reason;
    if (
      typeof reason !== 'string' ||
      !(ANSWER_REASONS as readonly string[]).includes(reason)
    ) {
      throw new Error(
        `Invalid answer response: unknown reason ${String(reason)}`,
      );
    }
    return {
      ok: false,
      reason: reason as 'no_hits' | 'semantic_unavailable' | 'synthesis_failed',
    };
  }
  throw new Error('Invalid answer response: missing ok flag');
}

function parseAnswerCitation(value: unknown): AnswerCitation {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer citation');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.source !== 'string' ||
    !(ANSWER_CITATION_SOURCES as readonly string[]).includes(obj.source) ||
    typeof obj.id !== 'string'
  ) {
    throw new Error('Invalid answer citation: missing required fields');
  }
  return { source: obj.source as RecallSource, id: obj.id };
}

function parseAnswerFilter(value: unknown): AnswerFilter {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer history record: filter not an object');
  }
  const obj = value as Record<string, unknown>;
  const filter: AnswerFilter = {};
  if (obj.topK !== undefined) {
    if (typeof obj.topK !== 'number') {
      throw new Error('Invalid answer history record: filter.topK not a number');
    }
    filter.topK = obj.topK;
  }
  if (obj.minScore !== undefined) {
    if (typeof obj.minScore !== 'number') {
      throw new Error(
        'Invalid answer history record: filter.minScore not a number',
      );
    }
    filter.minScore = obj.minScore;
  }
  if (obj.sources !== undefined) {
    if (!Array.isArray(obj.sources)) {
      throw new Error(
        'Invalid answer history record: filter.sources not an array',
      );
    }
    const sources: RecallSource[] = obj.sources.map((s) => {
      if (
        typeof s !== 'string' ||
        !(ANSWER_CITATION_SOURCES as readonly string[]).includes(s)
      ) {
        throw new Error(
          `Invalid answer history record: unknown source ${String(s)}`,
        );
      }
      return s as RecallSource;
    });
    filter.sources = sources;
  }
  return filter;
}

function parseAnswerHistoryEntry(value: unknown): AnswerHistoryEntry {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer history entry: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.createdAt !== 'string' ||
    typeof obj.query !== 'string'
  ) {
    throw new Error('Invalid answer history entry: missing required fields');
  }
  const result = obj.result;
  if (result === null || typeof result !== 'object') {
    throw new Error('Invalid answer history entry: result not an object');
  }
  const r = result as Record<string, unknown>;
  if (r.ok === true) {
    if (typeof r.citationCount !== 'number') {
      throw new Error('Invalid answer history entry: citationCount not a number');
    }
    return {
      id: obj.id,
      createdAt: obj.createdAt,
      query: obj.query,
      result: { ok: true, citationCount: r.citationCount },
    };
  }
  if (r.ok === false) {
    if (
      typeof r.reason !== 'string' ||
      !(ANSWER_REASONS as readonly string[]).includes(r.reason)
    ) {
      throw new Error(
        `Invalid answer history entry: unknown reason ${String(r.reason)}`,
      );
    }
    return {
      id: obj.id,
      createdAt: obj.createdAt,
      query: obj.query,
      result: {
        ok: false,
        reason: r.reason as
          | 'no_hits'
          | 'semantic_unavailable'
          | 'synthesis_failed',
      },
    };
  }
  throw new Error('Invalid answer history entry: missing ok flag');
}

export function parseAnswerHistoryListResult(
  value: unknown,
): AnswerHistoryListResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer history list response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) {
    throw new Error('Invalid answer history list response: entries missing');
  }
  const entries = obj.entries.map(parseAnswerHistoryEntry);
  return { entries };
}

function parseAnswerHistoryRecord(value: unknown): AnswerHistoryRecord {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer history record: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.createdAt !== 'string' ||
    typeof obj.query !== 'string'
  ) {
    throw new Error('Invalid answer history record: missing required fields');
  }
  if (!Array.isArray(obj.recallHits)) {
    throw new Error('Invalid answer history record: recallHits missing');
  }
  const filter = parseAnswerFilter(obj.filter);
  const recallHits = obj.recallHits.map(parseRecallHit);
  const result = parseAnswerResult(obj.result);
  return {
    id: obj.id,
    createdAt: obj.createdAt,
    query: obj.query,
    filter,
    recallHits,
    result,
  };
}

export function parseAnswerHistoryShowResult(
  value: unknown,
): AnswerHistoryShowResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid answer history show response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    return { ok: true, record: parseAnswerHistoryRecord(obj.record) };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'not_found') {
      throw new Error(
        `Invalid answer history show response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'not_found' };
  }
  throw new Error('Invalid answer history show response: missing ok flag');
}
