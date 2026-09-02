import type { Memory, MemoryProvider } from "#core/modules/provider-types.js";
import type {
  MemoryDeleteResult,
  MemoryListFilter,
  MemoryListResult,
  MemoryReindexResult,
  MemorySearchFilter,
  MemorySearchResult,
} from "./client.js";

function toListEntry(memory: Memory): MemoryListResult["entries"][number] {
  return {
    id: memory.id,
    created: memory.created,
    ...(memory.updated && { updated: memory.updated }),
    content: memory.content,
    ...(memory.provenance && { provenance: memory.provenance }),
    ...(memory.freshness && { freshness: memory.freshness }),
  };
}

export function listMemory(
  provider: MemoryProvider,
  filter?: MemoryListFilter,
): MemoryListResult {
  const entries = provider.list().map(toListEntry);
  return {
    entries: filter?.limit === undefined ? entries : entries.slice(0, filter.limit),
  };
}

export function deleteMemory(
  provider: MemoryProvider,
  id: string,
): MemoryDeleteResult {
  return provider.delete(id) ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function searchMemory(
  provider: MemoryProvider,
  query: string,
  filter?: MemorySearchFilter,
): Promise<MemorySearchResult> {
  const limit = filter?.limit ?? 20;
  if (filter?.semantic) {
    const semantic = provider.semanticSearchCapability;
    if (!semantic) return { ok: false, reason: "semantic_unavailable" };
    const entries = await semantic.semanticSearch(query, limit, {
      tag: filter.tag,
      since: filter.since,
    });
    return { ok: true, entries: entries.map(toListEntry) };
  }
  const entries = provider
    .search(query, { tag: filter?.tag, since: filter?.since })
    .slice(0, limit);
  return { ok: true, entries: entries.map(toListEntry) };
}

export async function reindexMemory(
  provider: MemoryProvider,
): Promise<MemoryReindexResult> {
  const semantic = provider.semanticSearchCapability;
  if (!semantic) return { ok: false, reason: "semantic_unavailable" };
  return { ok: true, ...await semantic.reindex() };
}
