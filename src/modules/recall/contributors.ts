/**
 * Adapters that wrap each first-party store provider into a
 * `RecallContributor`. The adapters are owned by the recall module so
 * adding a new contributor (a fifth store) is a registration here, not an
 * edit across every consumer.
 *
 * Per-source scoring strategy:
 *
 * - tasks: use the cosine score `searchTasks` already returns (semantic) or
 *   the keyword fallback's weighted token count. Both are absolute numbers
 *   the seam can min-max normalize.
 * - knowledge / memory / history: the underlying providers return ranked
 *   lists without explicit scores, so the contributor uses the rank index
 *   itself (`topK - rank`) as the native score. Min-max normalization at
 *   the seam still rescales it to `[0, 1]` per source.
 *
 * Graceful degradation: a contributor that has no semantic backend falls
 * back to its provider's keyword search. A query that throws (e.g.
 * embedding endpoint unreachable) returns an empty array — the seam catches
 * the partial result and continues with the remaining contributors.
 */
import type {
  HistoryProvider,
  KnowledgeProvider,
  MemoryProvider,
  RepoTasksProvider,
} from "#core/modules/provider-types.js";
import type { RawRecallEntry, RecallContributor } from "./recall-types.js";

const PREVIEW_MAX = 240;

function clipPreview(input: string): string {
  const flat = input.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_MAX) return flat;
  return `${flat.slice(0, PREVIEW_MAX - 1)}…`;
}

function rankScore(rank: number, topK: number): number {
  return Math.max(1, topK - rank);
}

export function createKnowledgeContributor(
  provider: KnowledgeProvider,
): RecallContributor {
  return {
    source: "knowledge",
    async recall(query, { topK }) {
      const entries = provider.supportsSemanticSearch()
        ? await provider.semanticSearch(query, topK)
        : provider.search(query).slice(0, topK);
      return entries.map<RawRecallEntry>((entry, index) => ({
        source: "knowledge",
        id: entry.id,
        nativeScore: rankScore(index, topK),
        payload: {
          title: entry.title,
          preview: clipPreview(entry.content),
          updated: entry.updated,
        },
      }));
    },
  };
}

export function createMemoryContributor(
  provider: MemoryProvider,
): RecallContributor {
  return {
    source: "memory",
    async recall(query, { topK }) {
      const entries = provider.supportsSemanticSearch()
        ? await provider.semanticSearch(query, topK)
        : provider.search(query).slice(0, topK);
      return entries.map<RawRecallEntry>((entry, index) => ({
        source: "memory",
        id: entry.id,
        nativeScore: rankScore(index, topK),
        payload: {
          preview: clipPreview(entry.content),
          created: entry.created,
        },
      }));
    },
  };
}

export function createHistoryContributor(
  provider: HistoryProvider,
): RecallContributor {
  return {
    source: "history",
    async recall(query, { topK }) {
      const entries = provider.supportsSemanticSearch()
        ? await provider.semanticSearch(query, topK)
        : provider.list({ search: query, limit: topK });
      return entries.map<RawRecallEntry>((entry, index) => ({
        source: "history",
        id: entry.id,
        nativeScore: rankScore(index, topK),
        payload: {
          title: entry.title,
          cwd: entry.cwd,
          updatedAt: entry.updatedAt,
        },
      }));
    },
  };
}

export function createTasksContributor(
  provider: RepoTasksProvider,
): RecallContributor {
  return {
    source: "tasks",
    async recall(query, { topK }) {
      const hits = await provider.searchTasks(query, { topK });
      return hits.map<RawRecallEntry>((hit) => ({
        source: "tasks",
        id: hit.id,
        nativeScore: hit.score,
        payload: {
          title: hit.title,
          state: hit.state,
          priority: hit.priority,
          updatedAt: hit.updatedAt,
        },
      }));
    },
  };
}
