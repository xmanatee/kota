/**
 * RecallProviderImpl — merges N contributors into one ranked, source-tagged
 * list.
 *
 * Score normalization is per-source min-max rescaling into `[0, 1]`. The
 * seam does this once after every contributor's batch arrives so each
 * contributor can use whatever native scoring fits its backend (cosine,
 * weighted token count, rank-derived) without coordinating ranges.
 *
 * Tie-breaking after the normalized score is `RECALL_SOURCE_ORDER` then id
 * (ASCII compare). The same query against the same data therefore returns
 * the same ordering on repeat calls.
 */
import type { RecallFilter, RecallHit } from "./client.js";
import {
  type RawRecallEntry,
  RECALL_DEFAULT_TOP_K,
  RECALL_SOURCE_ORDER,
  type RecallContributor,
  type RecallProvider,
  type RecallSource,
} from "./recall-types.js";

type ScoredEntry = RawRecallEntry & { normalized: number };

function normalizeBatch(batch: RawRecallEntry[]): ScoredEntry[] {
  if (batch.length === 0) return [];
  if (batch.length === 1) {
    return [{ ...batch[0], normalized: 1 }];
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const hit of batch) {
    if (hit.nativeScore < min) min = hit.nativeScore;
    if (hit.nativeScore > max) max = hit.nativeScore;
  }
  const range = max - min;
  if (range === 0) {
    return batch.map((hit) => ({ ...hit, normalized: 1 }));
  }
  return batch.map((hit) => ({
    ...hit,
    normalized: (hit.nativeScore - min) / range,
  }));
}

function sourceRank(source: RecallSource): number {
  const idx = RECALL_SOURCE_ORDER.indexOf(source);
  return idx === -1 ? RECALL_SOURCE_ORDER.length : idx;
}

function compareScored(a: ScoredEntry, b: ScoredEntry): number {
  if (b.normalized !== a.normalized) return b.normalized - a.normalized;
  const sa = sourceRank(a.source);
  const sb = sourceRank(b.source);
  if (sa !== sb) return sa - sb;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function toRecallHit(entry: ScoredEntry): RecallHit {
  switch (entry.source) {
    case "knowledge":
      return {
        source: "knowledge",
        score: entry.normalized,
        id: entry.id,
        title: entry.payload.title,
        preview: entry.payload.preview,
        updated: entry.payload.updated,
      };
    case "memory":
      return {
        source: "memory",
        score: entry.normalized,
        id: entry.id,
        preview: entry.payload.preview,
        created: entry.payload.created,
      };
    case "history":
      return {
        source: "history",
        score: entry.normalized,
        id: entry.id,
        title: entry.payload.title,
        cwd: entry.payload.cwd,
        updatedAt: entry.payload.updatedAt,
      };
    case "tasks":
      return {
        source: "tasks",
        score: entry.normalized,
        id: entry.id,
        title: entry.payload.title,
        state: entry.payload.state,
        priority: entry.payload.priority,
        updatedAt: entry.payload.updatedAt,
      };
    case "answer":
      return {
        source: "answer",
        score: entry.normalized,
        id: entry.id,
        query: entry.payload.query,
        preview: entry.payload.preview,
        citationCount: entry.payload.citationCount,
        createdAt: entry.payload.createdAt,
        result: entry.payload.result,
      };
  }
}

export type RecallProviderOptions = {
  /**
   * Optional callback fired when a contributor throws or rejects. Defaults
   * to `console.error`. Tests inject a quiet sink to keep output clean.
   */
  onContributorError?: (source: RecallSource, error: unknown) => void;
};

export class RecallProviderImpl implements RecallProvider {
  private readonly bySource = new Map<RecallSource, RecallContributor>();
  private readonly order: RecallSource[] = [];
  private readonly onContributorError: NonNullable<
    RecallProviderOptions["onContributorError"]
  >;

  constructor(options: RecallProviderOptions = {}) {
    this.onContributorError =
      options.onContributorError ??
      ((source, err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[recall] ${source} contributor failed: ${msg}`);
      });
  }

  register(contributor: RecallContributor): void {
    if (!this.bySource.has(contributor.source)) {
      this.order.push(contributor.source);
    }
    this.bySource.set(contributor.source, contributor);
  }

  unregister(source: RecallSource): void {
    if (!this.bySource.delete(source)) return;
    const idx = this.order.indexOf(source);
    if (idx >= 0) this.order.splice(idx, 1);
  }

  contributors(): ReadonlyArray<RecallSource> {
    return this.order.slice();
  }

  async recall(query: string, filter?: RecallFilter): Promise<RecallHit[]> {
    const trimmed = query.trim();
    if (trimmed === "") return [];
    const topK = filter?.topK ?? RECALL_DEFAULT_TOP_K;
    if (topK <= 0) return [];
    const minScore = filter?.minScore ?? 0;
    const allowed: ReadonlySet<RecallSource> = filter?.sources && filter.sources.length > 0
      ? new Set(filter.sources)
      : new Set(this.order);

    const targets = this.order.filter((source) => allowed.has(source));
    if (targets.length === 0) return [];

    const batches = await Promise.all(
      targets.map(async (source) => {
        const contributor = this.bySource.get(source);
        if (!contributor) return [] as RawRecallEntry[];
        try {
          return await contributor.recall(trimmed, { topK });
        } catch (err) {
          this.onContributorError(source, err);
          return [] as RawRecallEntry[];
        }
      }),
    );

    const scored: ScoredEntry[] = [];
    for (const batch of batches) {
      for (const hit of normalizeBatch(batch)) scored.push(hit);
    }
    scored.sort(compareScored);
    const filtered = minScore > 0
      ? scored.filter((entry) => entry.normalized >= minScore)
      : scored;
    return filtered.slice(0, topK).map(toRecallHit);
  }
}
