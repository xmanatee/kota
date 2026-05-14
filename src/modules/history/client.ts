/**
 * History namespace client contract.
 *
 * The history module owns its KotaClient namespace surface end-to-end:
 * this file declares the list/show/delete/search/reindex types and the
 * `HistoryClient` interface that the `KotaClient` aggregate composes. Both
 * the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) realize this
 * contract; the `kota history` CLI subcommands consume it through
 * `ctx.client.history` or by importing these types from
 * `#modules/history/client.js`.
 */

import type {
  ConversationData,
  ConversationRecord,
  ReindexResult,
} from "#core/modules/provider-types.js";

/**
 * Optional project boundary for callers that already hold an explicit
 * project id, such as `KotaClient.forProject(...)` wrappers. When
 * absent, the implementation resolves the active/default project once at the
 * client or route boundary.
 */
export type HistoryProjectSelection = {
  projectId?: string;
};

/**
 * Filter for `HistoryClient.list`.
 *
 * The CLI uses `cwd` to scope the per-directory list (default `kota history list`),
 * `--all` to include every directory, and `search` for substring matching against
 * title or cwd. `source` distinguishes user-initiated chats from internal
 * action-driven sessions. Defaults match the underlying store: when `limit` is
 * absent the implementor returns the same default the store would (20).
 */
export type HistoryListFilter = HistoryProjectSelection & {
  search?: string;
  limit?: number;
  cwd?: string;
  source?: "user" | "action";
};

export type HistoryListResult = {
  conversations: ConversationRecord[];
};

/** Result of `history.show(id)`. Returns the full conversation data on success. */
export type HistoryShowResult =
  | { found: true; data: ConversationData }
  | { found: false };

/** Result of `history.delete(id)`. */
export type HistoryDeleteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

/** Result of `history.reindex`. Mirrors the provider's `ReindexResult`. */
export type HistoryReindexResult = ReindexResult;

/** Filter for `history.search`. */
export type HistorySearchFilter = HistoryProjectSelection & {
  cwd?: string;
  source?: "user" | "action";
  semantic?: boolean;
  limit?: number;
};

/**
 * Result of `history.search`. Semantic ranking requires an embedding-backed
 * provider; when the caller asks for `semantic: true` and the active provider
 * cannot satisfy that, the contract surfaces an explicit
 * `semantic_unavailable` rather than silently falling back to keyword search.
 */
export type HistorySearchResult =
  | { ok: true; conversations: ConversationRecord[] }
  | { ok: false; reason: "semantic_unavailable" };

/**
 * Conversation-history operations.
 *
 * `list` returns conversation records filtered by `search` / `limit` /
 * `cwd` / `source`. `show` returns the full `ConversationData`
 * (record + messages + compaction metadata) for a single conversation.
 * `delete` removes a conversation. The contract is intentionally minimal:
 * id-prefix and most-recent-by-cwd resolution are derived in the CLI from
 * `list` (see `resolveConversationId`) so the contract stays a single
 * pass-through for stored state, not a query DSL.
 */
export interface HistoryClient {
  list(filter?: HistoryListFilter): Promise<HistoryListResult>;
  show(id: string, project?: HistoryProjectSelection): Promise<HistoryShowResult>;
  delete(id: string, project?: HistoryProjectSelection): Promise<HistoryDeleteResult>;
  /**
   * Run semantic or keyword search across stored conversations. Semantic
   * ranking requires an embedding-backed provider; when the caller asks for
   * `semantic: true` and the active provider cannot satisfy that, the
   * contract surfaces an explicit `semantic_unavailable` rather than silently
   * falling back to keyword search.
   */
  search(query: string, filter?: HistorySearchFilter): Promise<HistorySearchResult>;
  /** Rebuild the semantic index over all conversations when the active provider supports it. */
  reindex(project?: HistoryProjectSelection): Promise<HistoryReindexResult>;
}
