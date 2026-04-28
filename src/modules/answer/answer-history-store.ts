/**
 * Persistence layer for cited-answer envelopes.
 *
 * One file per call under `<projectStateRoot>/answer-history/<id>.json`.
 * The store is the single record-keeping path for the answer module —
 * `AnswerProviderImpl` calls `appendAnswer` after every envelope (success
 * or failure) and a logged warning, not an exception, signals a failed
 * append. The operator-visible response is never altered by persistence.
 *
 * The id format mirrors `.kota/runs/` — an ISO timestamp with a short
 * random suffix — so list ordering by filename is the same as ordering
 * by `createdAt` and operators recognize the shape from workflow runs.
 *
 * Retention is module-internal: on append the store prunes the oldest
 * entries past `historyCap`. Pruning is best-effort and is wrapped in
 * `try/catch` so a stat/unlink failure cannot bubble into the caller.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type {
  AnswerFilter,
  AnswerHistoryEntry,
  AnswerHistoryListFilter,
  AnswerHistoryRecord,
  AnswerResult,
  RecallHit,
} from "#core/server/kota-client.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";

export const ANSWER_HISTORY_DIR_NAME = "answer-history";
export const ANSWER_HISTORY_DEFAULT_CAP = 1000;
const ANSWER_HISTORY_DEFAULT_LIMIT = 20;
const ANSWER_HISTORY_MAX_LIMIT = 200;

/**
 * Narrow append surface the provider consumes. The full store also
 * exposes list/show, but the provider only ever appends — keeping the
 * type narrow lets unit tests inject an in-memory recorder without
 * stubbing reads they will not exercise.
 */
export interface AnswerHistorySink {
  appendAnswer(record: AnswerHistoryRecord): Promise<void>;
}

/**
 * Full read surface used by the CLI subcommands and HTTP routes.
 * Implementations must not return null entries — `getAnswer` discriminates
 * "no record by that id" via its return type.
 */
export interface AnswerHistoryStore extends AnswerHistorySink {
  listAnswers(filter?: AnswerHistoryListFilter): Promise<AnswerHistoryEntry[]>;
  getAnswer(id: string): Promise<AnswerHistoryRecord | null>;
}

export type AnswerHistoryStoreOptions = {
  rootDir: string;
  /**
   * Soft cap on retained records. `appendAnswer` prunes oldest entries
   * past this cap on a best-effort basis. Defaults to
   * `ANSWER_HISTORY_DEFAULT_CAP`. Tests pass a small value to exercise
   * the prune path.
   */
  historyCap?: number;
  /**
   * Optional clock for deterministic tests. Defaults to `Date.now`.
   */
  now?: () => number;
};

/**
 * Mint a sortable id matching the `.kota/runs/` style — ISO timestamp
 * with `:` and `.` replaced so it is filename-safe, plus a short random
 * suffix to disambiguate two appends in the same millisecond.
 */
export function mintAnswerHistoryId(now: number = Date.now()): string {
  const iso = new Date(now).toISOString();
  const safe = iso.replace(/[:.]/g, "-");
  const suffix = randomBytes(3).toString("hex");
  return `${safe}-${suffix}`;
}

function normalizeLimit(raw: number | undefined): number {
  if (raw === undefined) return ANSWER_HISTORY_DEFAULT_LIMIT;
  if (!Number.isFinite(raw) || raw <= 0) return ANSWER_HISTORY_DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), ANSWER_HISTORY_MAX_LIMIT);
}

function projectionFromResult(
  result: AnswerResult,
): AnswerHistoryEntry["result"] {
  if (result.ok) return { ok: true, citationCount: result.citations.length };
  return { ok: false, reason: result.reason };
}

export function projectAnswerHistoryEntry(
  record: AnswerHistoryRecord,
): AnswerHistoryEntry {
  return {
    id: record.id,
    createdAt: record.createdAt,
    query: record.query,
    result: projectionFromResult(record.result),
  };
}

export type BuildHistoryRecordInput = {
  id: string;
  createdAt: string;
  query: string;
  filter: AnswerFilter;
  recallHits: RecallHit[];
  result: AnswerResult;
};

export function buildAnswerHistoryRecord(
  input: BuildHistoryRecordInput,
): AnswerHistoryRecord {
  return {
    id: input.id,
    createdAt: input.createdAt,
    query: input.query,
    filter: input.filter,
    recallHits: input.recallHits,
    result: input.result,
  };
}

/**
 * Disk-backed answer-history store. One JSON file per record; reads
 * scan the directory listing and decode lazily so a large store does
 * not have to be loaded into memory all at once.
 */
export class DiskAnswerHistoryStore implements AnswerHistoryStore {
  private readonly rootDir: string;
  private readonly historyCap: number;

  constructor(options: AnswerHistoryStoreOptions) {
    this.rootDir = options.rootDir;
    this.historyCap = options.historyCap ?? ANSWER_HISTORY_DEFAULT_CAP;
  }

  async appendAnswer(record: AnswerHistoryRecord): Promise<void> {
    mkdirSync(this.rootDir, { recursive: true });
    writeJsonFileAtomic(this.recordPath(record.id), record);
    this.pruneOldest();
  }

  async listAnswers(
    filter?: AnswerHistoryListFilter,
  ): Promise<AnswerHistoryEntry[]> {
    const limit = normalizeLimit(filter?.limit);
    const ids = this.listIdsNewestFirst();
    const filtered = filter?.beforeId
      ? ids.slice(ids.indexOf(filter.beforeId) + 1)
      : ids;
    if (filter?.beforeId && !ids.includes(filter.beforeId)) return [];
    const out: AnswerHistoryEntry[] = [];
    for (const id of filtered) {
      if (out.length >= limit) break;
      const record = this.readRecord(id);
      if (record) out.push(projectAnswerHistoryEntry(record));
    }
    return out;
  }

  async getAnswer(id: string): Promise<AnswerHistoryRecord | null> {
    if (!isSafeId(id)) return null;
    return this.readRecord(id);
  }

  private recordPath(id: string): string {
    return join(this.rootDir, `${id}.json`);
  }

  private listIdsNewestFirst(): string[] {
    let entries: string[];
    try {
      entries = readdirSync(this.rootDir);
    } catch {
      return [];
    }
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .sort()
      .reverse();
  }

  private readRecord(id: string): AnswerHistoryRecord | null {
    const path = this.recordPath(id);
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8");
    } catch {
      return null;
    }
    return JSON.parse(raw) as AnswerHistoryRecord;
  }

  private pruneOldest(): void {
    try {
      const ids = this.listIdsNewestFirst();
      if (ids.length <= this.historyCap) return;
      const toRemove = ids.slice(this.historyCap);
      for (const id of toRemove) {
        try {
          unlinkSync(this.recordPath(id));
        } catch {
          /* best-effort prune */
        }
      }
    } catch {
      /* best-effort prune */
    }
  }
}

const ID_REGEX = /^[A-Za-z0-9_-]+$/;
function isSafeId(id: string): boolean {
  return ID_REGEX.test(id);
}

export function answerHistoryRootForProject(projectStateRoot: string): string {
  return join(projectStateRoot, ANSWER_HISTORY_DIR_NAME);
}
