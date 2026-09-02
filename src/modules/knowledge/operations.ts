import type { KnowledgeProvider, SearchFilters } from "#core/modules/provider-types.js";
import type {
  KnowledgeDeleteResult,
  KnowledgeListFilter,
  KnowledgeListResult,
  KnowledgeReindexResult,
  KnowledgeSearchFilter,
  KnowledgeSearchResult,
  KnowledgeShowResult,
} from "./client.js";

function searchFilters(
  filter: KnowledgeListFilter | KnowledgeSearchFilter | undefined,
): SearchFilters {
  return {
    tag: filter?.tag,
    type: filter?.type,
    status: filter?.status,
    scope: filter?.scope,
  };
}

export function listKnowledge(
  provider: KnowledgeProvider,
  filter?: KnowledgeListFilter,
): KnowledgeListResult {
  return { entries: provider.list(searchFilters(filter)) };
}

export function showKnowledge(
  provider: KnowledgeProvider,
  id: string,
): KnowledgeShowResult {
  const entry = provider.read(id);
  return entry ? { found: true, entry } : { found: false };
}

export function deleteKnowledge(
  provider: KnowledgeProvider,
  id: string,
): KnowledgeDeleteResult {
  return provider.delete(id) ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function searchKnowledge(
  provider: KnowledgeProvider,
  query: string,
  filter?: KnowledgeSearchFilter,
): Promise<KnowledgeSearchResult> {
  const limit = filter?.limit ?? 20;
  const filters = searchFilters(filter);
  if (filter?.semantic) {
    const semantic = provider.semanticSearchCapability;
    if (!semantic) return { ok: false, reason: "semantic_unavailable" };
    return {
      ok: true,
      entries: await semantic.semanticSearch(query, limit, filters),
    };
  }
  return { ok: true, entries: provider.search(query, filters).slice(0, limit) };
}

export async function reindexKnowledge(
  provider: KnowledgeProvider,
): Promise<KnowledgeReindexResult> {
  const semantic = provider.semanticSearchCapability;
  if (!semantic) return { ok: false, reason: "semantic_unavailable" };
  return { ok: true, ...await semantic.reindex() };
}
