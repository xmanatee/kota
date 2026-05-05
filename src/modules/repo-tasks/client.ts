/**
 * Repo-tasks namespace client contract.
 *
 * The repo-tasks module owns the `tasks` KotaClient namespace surface
 * end-to-end: this file declares the result/option types and the
 * `RepoTasksClient` interface that the `KotaClient` aggregate composes. The
 * local-side handler in `index.ts` (backed by `repo-tasks-domain.ts` and
 * `repo-tasks-operations.ts`) and the daemon-side handler
 * (`buildRepoTasksDaemonHandler` factory in `index.ts`) realize this
 * contract.
 */

import type {
  ReindexResult,
  RepoTaskSearchHit,
} from "#core/modules/provider-types.js";

/** A repo-task queue state, mirroring `data/tasks/<state>/`. */
export type RepoTaskState =
  | "backlog"
  | "ready"
  | "doing"
  | "blocked"
  | "done"
  | "dropped";

/** A single normalized repo-task entry as the CLI surfaces it. */
export type RepoTaskListEntry = {
  id: string;
  priority: string;
  title: string;
  state: RepoTaskState;
};

export type RepoTaskListResult = {
  tasks: RepoTaskListEntry[];
};

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
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_in_state"; state: RepoTaskState };

/** Allowed task priorities. */
export type RepoTaskPriority = "p0" | "p1" | "p2" | "p3";

export type RepoTaskCreateOptions = {
  title: string;
  priority: RepoTaskPriority;
  area: string;
  state: RepoTaskState;
  summary?: string;
};

export type RepoTaskCreateResult =
  | { ok: true; id: string; path: string }
  | {
      ok: false;
      reason: "invalid_slug" | "already_exists";
      message?: string;
    };

export type RepoTaskCaptureResult =
  | { ok: true; id: string; path: string }
  | {
      ok: false;
      reason: "invalid_slug" | "already_exists";
      message?: string;
    };

/** Options accepted by `tasks.gc`. Defaults match the CLI: 30 days, archive. */
export type RepoTaskGcOptions = {
  days?: number;
  delete?: boolean;
  dryRun?: boolean;
};

export type RepoTaskGcResult = {
  archived: string[];
  deleted: string[];
};

/** Filter for `RepoTasksClient.search`. */
export type RepoTaskSearchFilter = {
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
export type RepoTaskReindexResult = ReindexResult;

/**
 * Repo-task queue operations (the `data/tasks/*` filesystem queue).
 *
 * `list` enumerates open-state task headers. `show` returns one task's full
 * file content. `move` transitions a task between any two states (including
 * the autonomy-owned `doing` and terminal `done`/`dropped`); web-UI restricted
 * moves stay on `/api/tasks/:id/state`. `create` writes a normalized task with
 * the full template; `capture` writes a quick `# title` inbox note. `gc`
 * archives or deletes terminal tasks older than the threshold.
 */
export interface RepoTasksClient {
  /**
   * List repo tasks restricted to the given queue states. When no states
   * are provided, the implementor returns all open states
   * (`backlog`, `ready`, `doing`, `blocked`).
   */
  list(states?: RepoTaskState[]): Promise<RepoTaskListResult>;
  show(id: string): Promise<RepoTaskShowResult>;
  move(id: string, toState: RepoTaskState): Promise<RepoTaskMoveResult>;
  create(options: RepoTaskCreateOptions): Promise<RepoTaskCreateResult>;
  capture(title: string): Promise<RepoTaskCaptureResult>;
  gc(options?: RepoTaskGcOptions): Promise<RepoTaskGcResult>;
  /**
   * Run semantic or keyword ranking across the repo task queue. Semantic
   * ranking requires an embedding-backed provider; when the caller asks
   * for `semantic: true` and the active provider cannot satisfy that, the
   * contract surfaces an explicit `semantic_unavailable` rather than
   * silently falling back to keyword search.
   */
  search(query: string, filter?: RepoTaskSearchFilter): Promise<RepoTaskSearchResult>;
  /** Rebuild the semantic index over the repo task queue when the active provider supports it. */
  reindex(): Promise<RepoTaskReindexResult>;
}
