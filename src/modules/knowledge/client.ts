/**
 * Knowledge namespace client contract.
 *
 * The knowledge module owns its KotaClient namespace surface end-to-end:
 * this file declares the list/show/search/add/delete/reindex types and the
 * `KnowledgeClient` interface that the `KotaClient` aggregate composes. Both
 * the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) realize this
 * contract; the `kota knowledge` CLI subcommands consume it through
 * `ctx.client.knowledge` or by importing these types from
 * `#modules/knowledge/client.js`.
 */

import type {
  KnowledgeEntry,
  ReindexResult,
} from "#core/modules/provider-types.js";

/** Knowledge storage scope. Mirrors `SearchFilters.scope` in provider types. */
export type KnowledgeScope = "project" | "global" | "all";

/** Storage scope for a writable knowledge entry. */
export type KnowledgeWritableScope = "project" | "global";

/**
 * Filter for `KnowledgeClient.list`.
 *
 * `scope` defaults to undefined (loads both project + global directories,
 * mirroring `KnowledgeStore.list`). Callers that want to restrict to a single
 * scope or include only the global store pass it explicitly. Slicing by
 * `limit` is left to the caller — the contract returns the full filtered set.
 */
export type KnowledgeListFilter = {
  tag?: string;
  type?: string;
  status?: string;
  scope?: KnowledgeScope;
};

export type KnowledgeListResult = {
  entries: KnowledgeEntry[];
};

/** Result of `knowledge.show(id)`. Returns the full entry on success. */
export type KnowledgeShowResult =
  | { found: true; entry: KnowledgeEntry }
  | { found: false };

/** Filter for `KnowledgeClient.search`. */
export type KnowledgeSearchFilter = {
  tag?: string;
  type?: string;
  status?: string;
  scope?: KnowledgeScope;
  semantic?: boolean;
  limit?: number;
};

/**
 * Result of `knowledge.search`. Semantic ranking requires an embedding-backed
 * provider; when the caller asks for `semantic: true` and the active provider
 * cannot satisfy that, the contract surfaces an explicit
 * `semantic_unavailable` rather than silently falling back to keyword search.
 */
export type KnowledgeSearchResult =
  | { ok: true; entries: KnowledgeEntry[] }
  | { ok: false; reason: "semantic_unavailable" };

/** Options for `knowledge.add`. */
export type KnowledgeAddOptions = {
  title: string;
  content: string;
  type?: string;
  tags?: string[];
  status?: string;
  scope?: KnowledgeWritableScope;
  meta?: Record<string, string>;
};

export type KnowledgeAddResult = { id: string };

/** Result of `knowledge.delete`. */
export type KnowledgeDeleteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

/** Result of `knowledge.reindex`. Mirrors the provider's `ReindexResult`. */
export type KnowledgeReindexResult = ReindexResult;

/**
 * Knowledge-store operations (the structured markdown+frontmatter store).
 *
 * `list` returns full entries (filterable by tag/type/status/scope) so list,
 * show, and export callers share one shape. `search` runs keyword or semantic
 * matching and surfaces `semantic_unavailable` explicitly when an
 * embedding-backed provider is required but absent. `show` returns one full
 * entry. `add` creates an entry with the project/global scope default and
 * returns its id. `delete` removes a single entry. `reindex` rebuilds the
 * semantic index when the provider supports it.
 */
export interface KnowledgeClient {
  list(filter?: KnowledgeListFilter): Promise<KnowledgeListResult>;
  show(id: string): Promise<KnowledgeShowResult>;
  search(query: string, filter?: KnowledgeSearchFilter): Promise<KnowledgeSearchResult>;
  add(options: KnowledgeAddOptions): Promise<KnowledgeAddResult>;
  delete(id: string): Promise<KnowledgeDeleteResult>;
  reindex(): Promise<KnowledgeReindexResult>;
}
