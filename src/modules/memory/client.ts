/**
 * Memory namespace client contract.
 *
 * The memory module owns its KotaClient namespace surface end-to-end:
 * this file declares the list/add/delete/search/reindex types and the
 * `MemoryClient` interface that the `KotaClient` aggregate composes. Both
 * the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) realize this
 * contract; the `kota memory` CLI subcommands consume it through
 * `ctx.client.memory` or by importing these types from
 * `#modules/memory/client.js`.
 */

import type { ReindexResult } from "#core/modules/provider-types.js";

/** A masked memory entry as the CLI surfaces it. */
export type MemoryListEntry = {
  id: string;
  created: string;
  content: string;
};

export type MemoryListResult = {
  entries: MemoryListEntry[];
};

/**
 * Optional project boundary for callers that already hold an explicit
 * project id, such as future `KotaClient.forProject(...)` wrappers. When
 * absent, the implementation resolves the active/default project once at the
 * client or route boundary.
 */
export type MemoryProjectSelection = {
  projectId?: string;
};

/** Filter for `memory.list`. */
export type MemoryListFilter = MemoryProjectSelection & {
  limit?: number;
};

/** Result of `memory.add`. */
export type MemoryAddResult = { id: string };

/** Result of `memory.delete`. */
export type MemoryDeleteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

/** Filter for `memory.search`. */
export type MemorySearchFilter = MemoryProjectSelection & {
  tag?: string;
  since?: string;
  semantic?: boolean;
  limit?: number;
};

/**
 * Result of `memory.search`. Semantic ranking requires an embedding-backed
 * provider; when the caller asks for `semantic: true` and the active provider
 * cannot satisfy that, the contract surfaces an explicit
 * `semantic_unavailable` rather than silently falling back to keyword search.
 */
export type MemorySearchResult =
  | { ok: true; entries: MemoryListEntry[] }
  | { ok: false; reason: "semantic_unavailable" };

/** Result of `memory.reindex`. Mirrors the provider's `ReindexResult`. */
export type MemoryReindexResult = ReindexResult;

/**
 * Memory-store operations.
 *
 * `list` returns recent entries. `add` writes a new entry and returns its
 * id. `delete` mutates a single entry. `search` runs keyword or semantic
 * matching and surfaces `semantic_unavailable` explicitly when an
 * embedding-backed provider is required but absent. `reindex` rebuilds the
 * semantic index when the provider supports it.
 */
export interface MemoryClient {
  /** List recent memory entries, newest first, capped at `limit`. */
  list(filter?: MemoryListFilter): Promise<MemoryListResult>;
  add(
    content: string,
    tags?: string[],
    project?: MemoryProjectSelection,
  ): Promise<MemoryAddResult>;
  delete(id: string, project?: MemoryProjectSelection): Promise<MemoryDeleteResult>;
  search(query: string, filter?: MemorySearchFilter): Promise<MemorySearchResult>;
  reindex(project?: MemoryProjectSelection): Promise<MemoryReindexResult>;
}
