/**
 * Repo-tasks namespace client contract.
 *
 * The repo-tasks module owns the `tasks` KotaClient namespace surface
 * end-to-end: this file declares the result/option types and the
 * `RepoTasksClient` interface that the `KotaClient` aggregate composes. The
 * local-side handler in `index.ts` (backed by `repo-tasks-domain.ts` and
 * `repo-tasks-operations.ts`) and the daemon-side handler
 * (`buildRepoTasksDaemonHandler` factory in `daemon-client.ts`) realize this
 * contract.
 */

import type {
  ReindexOperationResult,
  RepoTaskSearchHit,
} from "#core/modules/provider-types.js";
import type { ScopeSelector } from "#core/server/scope-selector.js";

/** A repo-task lifecycle state. Active tasks live directly in `data/tasks/`. */
export type RepoTaskState =
  | "open"
  | "blocked"
  | "done"
  | "dropped";

/** A single normalized repo-task entry as the CLI surfaces it. */
export type RepoTaskListEntry = {
  id: string;
  priority: RepoTaskPriority | null;
  title: string;
  state: RepoTaskState;
  /** Hard predecessor task ids that are not yet in done/. */
  waitingOnTasks: string[];
};

export type RepoTaskListResult = {
  tasks: RepoTaskListEntry[];
};

/**
 * Optional scopeSelector boundary for callers that already hold an explicit
 * scopeSelector id, such as `KotaClient.forScope(...)` wrappers. When absent,
 * the implementation resolves the active/default scopeSelector once at the client
 * or route boundary.
 */
export type RepoTaskScopeSelection = ScopeSelector;

/**
 * Result of `tasks.show(id)`. The full file content is returned with the
 * resolved state so callers can render it without re-resolving the task.
 */
export type RepoTaskShowResult =
  | { found: true; state: RepoTaskState; content: string }
  | { found: false };

/**
 * Result of `tasks.move(id, toState)`. `previousPath` and `path` are
 * repo-relative so callers can render or stage either side of the move.
 */
export type RepoTaskMoveResult =
  | {
      ok: true;
      id: string;
      fromState: RepoTaskState;
      toState: RepoTaskState;
      path: string;
      previousPath: string;
    }
  | { ok: false; reason: "invalid_id" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_in_state"; state: RepoTaskState };

export type RepoTaskUpdateBodyResult =
  | { ok: true; id: string; state: RepoTaskState; content: string }
  | { ok: false; reason: "invalid_id" | "not_found" | "terminal" | "malformed" };

/** Allowed task priorities. */
export type RepoTaskPriority = "p0" | "p1" | "p2" | "p3";

export type RepoTaskCreateOptions = ScopeSelector & {
  title: string;
  priority: RepoTaskPriority;
  state?: "open" | "blocked";
};

export type RepoTaskCreateResult =
  /** Successful paths are stable and repository-relative. */
  | { ok: true; id: string; path: string }
  | {
      ok: false;
      reason: "invalid_slug" | "already_exists";
      message?: string;
    };

export type RepoTaskCaptureResult =
  /** Successful paths are stable and repository-relative. */
  | { ok: true; id: string; path: string }
  | {
      ok: false;
      reason: "invalid_slug" | "already_exists";
      message?: string;
    };

/** Filter for `RepoTasksClient.search`. */
export type RepoTaskSearchFilter = RepoTaskScopeSelection & {
  /** Restrict matches to the listed states. Defaults to all states. */
  states?: ReadonlyArray<RepoTaskState>;
  /** Maximum hits returned, ranked by score. Defaults to 20. */
  limit?: number;
  /**
   * When true (default), use the active embedding-backed provider when one
   * is registered. When false, force the substring/grep keyword path
   * through the default provider for parity with prior behavior.
   */
  semantic?: boolean;
};

/**
 * Result of `tasks.search`. Semantic ranking requires an embedding-backed
 * provider; when the caller asks for `semantic: true` and the active
 * provider cannot satisfy that, the contract surfaces an explicit
 * `semantic_unavailable` rather than silently falling back to keyword
 * search — same shape as memory/knowledge/history.
 */
export type RepoTaskSearchResult =
  | { ok: true; tasks: RepoTaskSearchHit[] }
  | { ok: false; reason: "semantic_unavailable" };

/** Result of `tasks.reindex`. Mirrors the provider's `ReindexResult`. */
export type RepoTaskReindexResult = ReindexOperationResult;

/**
 * Repo-task queue operations (the `data/tasks/*` filesystem queue).
 *
 * `list` enumerates open-state task headers. `show` returns one task's full
 * file content. `move` transitions a task between active and terminal states;
 * web-UI restricted
 * moves stay on `/api/tasks/:id/state`. `create` writes a normalized active task;
 * `capture` writes a quick `# title` inbox note.
 */
export interface RepoTasksClient {
  /**
   * List repo tasks restricted to the given queue states. When no states
   * are provided, the implementor returns all open states
   * (`open`, `blocked`).
   */
  list(
    states?: RepoTaskState[],
    scopeSelector?: RepoTaskScopeSelection,
  ): Promise<RepoTaskListResult>;
  show(id: string, scopeSelector?: RepoTaskScopeSelection): Promise<RepoTaskShowResult>;
  move(
    id: string,
    toState: RepoTaskState,
    scopeSelector?: RepoTaskScopeSelection,
  ): Promise<RepoTaskMoveResult>;
  /** Replace the markdown body of one non-terminal task while preserving its front matter. */
  updateBody?(
    id: string,
    body: string,
    scopeSelector?: RepoTaskScopeSelection,
  ): Promise<RepoTaskUpdateBodyResult>;
  create(options: RepoTaskCreateOptions): Promise<RepoTaskCreateResult>;
  capture(
    title: string,
    scopeSelector?: RepoTaskScopeSelection,
  ): Promise<RepoTaskCaptureResult>;
  /**
   * Run semantic or keyword ranking across the repo task queue. Semantic
   * ranking requires an embedding-backed provider; when the caller asks
   * for `semantic: true` and the active provider cannot satisfy that, the
   * contract surfaces an explicit `semantic_unavailable` rather than
   * silently falling back to keyword search.
   */
  search(query: string, filter?: RepoTaskSearchFilter): Promise<RepoTaskSearchResult>;
  /** Rebuild the semantic index over the repo task queue when the active provider supports it. */
  reindex(scopeSelector?: RepoTaskScopeSelection): Promise<RepoTaskReindexResult>;
}
