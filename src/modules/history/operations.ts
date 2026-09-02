import type { HistoryProvider } from "#core/modules/provider-types.js";
import type {
  HistoryDeleteResult,
  HistoryListFilter,
  HistoryListResult,
  HistoryReindexResult,
  HistorySearchFilter,
  HistorySearchResult,
  HistoryShowOptions,
  HistoryShowResult,
} from "./client.js";
import { normalizeHistoryShowOptions, readHistoryDetail } from "./history-detail.js";

export function listHistory(
  provider: HistoryProvider,
  filter?: HistoryListFilter,
): HistoryListResult {
  return { conversations: provider.list(filter) };
}

export function showHistory(
  provider: HistoryProvider,
  id: string,
  options?: HistoryShowOptions,
): HistoryShowResult {
  return readHistoryDetail(provider, id, normalizeHistoryShowOptions(options));
}

export function deleteHistory(
  provider: HistoryProvider,
  id: string,
): HistoryDeleteResult {
  return provider.remove(id) ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function searchHistory(
  provider: HistoryProvider,
  query: string,
  filter?: HistorySearchFilter,
): Promise<HistorySearchResult> {
  const limit = filter?.limit ?? 20;
  if (filter?.semantic) {
    const semantic = provider.semanticSearchCapability;
    if (!semantic) return { ok: false, reason: "semantic_unavailable" };
    return {
      ok: true,
      conversations: await semantic.semanticSearch(query, limit, {
        cwd: filter.cwd,
        source: filter.source,
      }),
    };
  }
  return {
    ok: true,
    conversations: provider.list({
      search: query,
      limit,
      cwd: filter?.cwd,
      source: filter?.source,
    }),
  };
}

export async function reindexHistory(
  provider: HistoryProvider,
): Promise<HistoryReindexResult> {
  const semantic = provider.semanticSearchCapability;
  if (!semantic) return { ok: false, reason: "semantic_unavailable" };
  return { ok: true, ...await semantic.reindex() };
}
