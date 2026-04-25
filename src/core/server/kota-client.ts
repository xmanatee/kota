/**
 * KotaClient — the typed contract every CLI subcommand consumes for
 * daemon-or-local access to KOTA capabilities.
 *
 * The contract is the single public surface CLI code imports. Two
 * implementors realize it:
 *
 * - `DaemonControlClient` (HTTP) — talks to a running daemon over
 *   `127.0.0.1` using the bearer token published in
 *   `.kota/daemon-control.json`.
 * - `LocalKotaClient` (in-process) — talks directly to the local stores
 *   and providers when no daemon is reachable.
 *
 * A single `resolveKotaClient` selector picks one implementor at CLI
 * startup. Subcommands consume `ctx.client.<namespace>.<method>` and
 * never re-decide that policy themselves.
 *
 * New capabilities are added as namespaces. Each namespace is a typed
 * sub-interface with the operations the CLI needs. Module-owned local
 * implementations are registered through ModuleContext and assembled
 * into the `LocalKotaClient` by the selector.
 */
import type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
import type { WorkflowRunSummary } from "#core/daemon/daemon-control.js";
import type {
  OwnerQuestionStatus,
  PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import type {
  ConversationData,
  ConversationRecord,
  ReindexResult,
} from "#core/modules/provider-types.js";

/** A masked entry in the secret store (name and source only — never the value). */
export type SecretListEntry = {
  name: string;
  source: string;
};

export type SecretListResult = {
  secrets: SecretListEntry[];
};

/** Storage scope for a writable secret. Mirrors `SecretScope` in core/config/secrets. */
export type SecretScope = "project" | "global";

/** Result of `secrets.get(name)`. The contract is explicit about absence. */
export type SecretGetResult = { found: true; value: string } | { found: false };

/** Result of a writable secret operation (`set`, `remove`). */
export type SecretMutateResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "store_error"; message?: string };

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

/** A masked memory entry as the CLI surfaces it. */
export type MemoryListEntry = {
  id: string;
  created: string;
  content: string;
};

export type MemoryListResult = {
  entries: MemoryListEntry[];
};

/** Result of `memory.add`. */
export type MemoryAddResult = { id: string };

/** Result of `memory.delete`. */
export type MemoryDeleteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

/** Filter for `memory.search`. */
export type MemorySearchFilter = {
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

/** Filters accepted by `client.workflow.listRuns`. */
export type WorkflowRunsListFilter = {
  workflow?: string;
  limit?: number;
  tag?: string;
  causedByRunId?: string;
};

export type WorkflowRunsListResult = {
  runs: WorkflowRunSummary[];
};

export type ApprovalsListResult = {
  approvals: PendingApproval[];
};

/**
 * Filter for `ApprovalsClient.list`.
 *
 * `status` defaults to `"pending"` so the common "what needs my
 * attention?" call stays a one-liner. Pass `"all"` to include every
 * status (used by `kota approval history` and by callers that need to
 * count or render resolved items).
 */
export type ApprovalListFilter = {
  status?: ApprovalStatus | "all";
};

/** Result of an approval mutation (`approve`, `reject`). */
export type ApprovalMutateResult =
  | { ok: true; approval: PendingApproval }
  | { ok: false; reason: "not_found" };

/**
 * Filter for `OwnerQuestionsClient.list`.
 *
 * `status` defaults to `"pending"` so the common "what's blocking the owner?"
 * call stays a one-liner. Pass a specific resolved status (`"answered"`,
 * `"dismissed"`, `"expired"`) or `"all"` to include resolved items used by
 * `kota owner-question history` and any caller that needs the full archive.
 */
export type OwnerQuestionListFilter = {
  status?: OwnerQuestionStatus | "all";
};

export type OwnerQuestionsListResult = {
  questions: PendingOwnerQuestion[];
};

/** Result of an owner-question mutation (`answer`, `dismiss`). */
export type OwnerQuestionMutateResult =
  | { ok: true; question: PendingOwnerQuestion }
  | { ok: false; reason: "not_found" };

/**
 * Filter for `HistoryClient.list`.
 *
 * The CLI uses `cwd` to scope the per-directory list (default `kota history list`),
 * `--all` to include every directory, and `search` for substring matching against
 * title or cwd. `source` distinguishes user-initiated chats from internal
 * action-driven sessions. Defaults match the underlying store: when `limit` is
 * absent the implementor returns the same default the store would (20).
 */
export type HistoryListFilter = {
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

/** Workflow-related read operations. */
export interface WorkflowClient {
  /**
   * List recent workflow runs. The daemon implementor sources runs from
   * the daemon's in-memory tracker; the local implementor reads run
   * artifacts under `.kota/runs/`.
   */
  listRuns(filter?: WorkflowRunsListFilter): Promise<WorkflowRunsListResult>;
}

/**
 * Approval-queue operations.
 *
 * `list` reads the queue (filterable by status). `approve` / `reject`
 * mutate a single pending entry; the daemon implementor talks to the
 * running daemon's queue, and the local implementor talks to the
 * in-process queue. Tool execution that follows a successful approve
 * stays in the CLI — the contract carries only the queue-state change.
 */
export interface ApprovalsClient {
  list(filter?: ApprovalListFilter): Promise<ApprovalsListResult>;
  approve(id: string, note?: string): Promise<ApprovalMutateResult>;
  reject(id: string, reason?: string): Promise<ApprovalMutateResult>;
}

/**
 * Secret-store operations.
 *
 * `list` returns names plus their resolution source — never the values.
 * `get` returns the resolved value when present, or an explicit `{ found:
 * false }` when absent. Mutation methods (`set`, `remove`) target a
 * specific writable scope; reading respects the provider chain regardless
 * of scope.
 */
export interface SecretsClient {
  list(): Promise<SecretListResult>;
  get(name: string): Promise<SecretGetResult>;
  set(name: string, value: string, scope: SecretScope): Promise<SecretMutateResult>;
  remove(name: string, scope: SecretScope): Promise<SecretMutateResult>;
}

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
}

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
  list(limit?: number): Promise<MemoryListResult>;
  add(content: string, tags?: string[]): Promise<MemoryAddResult>;
  delete(id: string): Promise<MemoryDeleteResult>;
  search(query: string, filter?: MemorySearchFilter): Promise<MemorySearchResult>;
  reindex(): Promise<MemoryReindexResult>;
}

/**
 * Owner-question queue operations.
 *
 * `list` reads the queue (filterable by status). `answer` resolves a pending
 * question with the operator's answer; `dismiss` resolves a pending question
 * without a substantive answer. Both mutations return the resolved question
 * so callers can render attribution (`resolutionSource`, `resolvedAt`) or
 * surface follow-up details. Resolved-question history (CLI `history --since`,
 * `--status`, `-n`) is composed from `list({ status: "all" })` plus CLI-side
 * filtering — the contract carries the queue snapshot, not the filter
 * derivation.
 */
export interface OwnerQuestionsClient {
  list(filter?: OwnerQuestionListFilter): Promise<OwnerQuestionsListResult>;
  answer(id: string, answer: string): Promise<OwnerQuestionMutateResult>;
  dismiss(id: string, reason?: string): Promise<OwnerQuestionMutateResult>;
}

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
  show(id: string): Promise<HistoryShowResult>;
  delete(id: string): Promise<HistoryDeleteResult>;
}

/**
 * The single typed surface CLI code imports for daemon-or-local access.
 *
 * The contract grows by adding namespaces here, delegating in
 * `DaemonControlClient` to existing or new HTTP routes, and exposing
 * matching local handlers from the owning module's top-level
 * `localClient(ctx)` factory.
 */
export interface KotaClient {
  readonly workflow: WorkflowClient;
  readonly approvals: ApprovalsClient;
  readonly secrets: SecretsClient;
  readonly tasks: RepoTasksClient;
  readonly memory: MemoryClient;
  readonly ownerQuestions: OwnerQuestionsClient;
  readonly history: HistoryClient;
}

/**
 * Names of every namespace on `KotaClient`. Local handler registration
 * is keyed by these names; the selector validates that every namespace
 * is wired before constructing a `LocalKotaClient`.
 */
export const KOTA_CLIENT_NAMESPACES = [
  "workflow",
  "approvals",
  "secrets",
  "tasks",
  "memory",
  "ownerQuestions",
  "history",
] as const satisfies ReadonlyArray<keyof KotaClient>;

export type KotaClientNamespace = (typeof KOTA_CLIENT_NAMESPACES)[number];

/** Local-side handler bundle: one namespace impl per declared capability. */
export type LocalClientHandlers = {
  [K in KotaClientNamespace]: KotaClient[K];
};
