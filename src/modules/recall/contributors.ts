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
import type { HistoryProjectStores } from "#modules/history/project-scope.js";
import type { KnowledgeProjectStores } from "#modules/knowledge/project-scope.js";
import type { MemoryProjectStores } from "#modules/memory/project-scope.js";
import type { RepoTasksProjectStores } from "#modules/repo-tasks/project-scope.js";
import type {
  RawRecallEntry,
  RecallContributor,
  RecallProjectContext,
} from "./recall-types.js";

const PREVIEW_MAX = 240;

function clipPreview(input: string): string {
  const flat = input.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_MAX) return flat;
  return `${flat.slice(0, PREVIEW_MAX - 1)}…`;
}

function rankScore(rank: number, topK: number): number {
  return Math.max(1, topK - rank);
}

function requireProject(
  project: RecallProjectContext | undefined,
): RecallProjectContext {
  if (!project) {
    throw new Error("Recall contributor requires a project context");
  }
  return project;
}

function unknownProject(projectId: string): Error {
  return new Error(`Unknown project: ${projectId}`);
}

async function recallKnowledge(
  provider: KnowledgeProvider,
  query: string,
  topK: number,
): Promise<RawRecallEntry[]> {
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
}

async function recallMemory(
  provider: MemoryProvider,
  query: string,
  topK: number,
): Promise<RawRecallEntry[]> {
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
}

async function recallHistory(
  provider: HistoryProvider,
  query: string,
  topK: number,
): Promise<RawRecallEntry[]> {
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
}

async function recallTasks(
  provider: RepoTasksProvider,
  query: string,
  topK: number,
): Promise<RawRecallEntry[]> {
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
}

export function createKnowledgeContributor(
  provider: KnowledgeProvider,
): RecallContributor {
  return {
    source: "knowledge",
    async recall(query, { topK }) {
      return recallKnowledge(provider, query, topK);
    },
  };
}

export function createProjectKnowledgeContributor(
  stores: KnowledgeProjectStores,
): RecallContributor {
  return {
    source: "knowledge",
    async recall(query, { topK, project }) {
      const resolved = stores.resolve(requireProject(project).projectId);
      if (!resolved.ok) throw unknownProject(resolved.error.projectId);
      return recallKnowledge(resolved.store, query, topK);
    },
  };
}

export function createMemoryContributor(
  provider: MemoryProvider,
): RecallContributor {
  return {
    source: "memory",
    async recall(query, { topK }) {
      return recallMemory(provider, query, topK);
    },
  };
}

export function createProjectMemoryContributor(
  stores: MemoryProjectStores,
): RecallContributor {
  return {
    source: "memory",
    async recall(query, { topK, project }) {
      const resolved = stores.resolve(requireProject(project).projectId);
      if (!resolved.ok) throw unknownProject(resolved.error.projectId);
      return recallMemory(resolved.store, query, topK);
    },
  };
}

export function createHistoryContributor(
  provider: HistoryProvider,
): RecallContributor {
  return {
    source: "history",
    async recall(query, { topK }) {
      return recallHistory(provider, query, topK);
    },
  };
}

export function createProjectHistoryContributor(
  stores: HistoryProjectStores,
): RecallContributor {
  return {
    source: "history",
    async recall(query, { topK, project }) {
      const resolved = stores.resolve(requireProject(project).projectId);
      if (!resolved.ok) throw unknownProject(resolved.error.projectId);
      return recallHistory(resolved.store, query, topK);
    },
  };
}

export function createTasksContributor(
  provider: RepoTasksProvider,
): RecallContributor {
  return {
    source: "tasks",
    async recall(query, { topK }) {
      return recallTasks(provider, query, topK);
    },
  };
}

export function createProjectTasksContributor(
  stores: RepoTasksProjectStores,
): RecallContributor {
  return {
    source: "tasks",
    async recall(query, { topK, project }) {
      const resolved = stores.resolve(requireProject(project).projectId);
      if (!resolved.ok) throw unknownProject(resolved.error.projectId);
      return recallTasks(resolved.store, query, topK);
    },
  };
}
