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
import type { AgentToolPolicy } from "#core/agents/agent-types.js";
import type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
import type {
  InteractiveSession,
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "#core/daemon/daemon-control.js";
import type {
  OwnerQuestionStatus,
  PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import type {
  ConversationData,
  ConversationRecord,
  KnowledgeEntry,
  ReindexResult,
} from "#core/modules/provider-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";

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

/**
 * Workflow runtime snapshot returned by `client.workflow.status()`.
 *
 * Wraps the daemon's `WorkflowLiveStatus` with `pendingAbort`, which only the
 * daemon-down path can observe (a stale abort signal file lingering after a
 * crash). The daemon-up path always reports `pendingAbort: false` because the
 * daemon processes abort RPCs synchronously and never persists the file.
 */
export type WorkflowStatusSnapshot = WorkflowLiveStatus & {
  pendingAbort: boolean;
};

/** Result of `workflow.pause` / `workflow.resume`. `already` is true when the
 * call was a no-op (already paused / not paused). */
export type WorkflowPauseResult = { paused: boolean; already: boolean };

/**
 * Result of `workflow.abort` (active runs).
 *
 * `applied` means the daemon processed the abort synchronously and `count` is
 * how many active runs were told to abort. `signaled` means no daemon was
 * reachable and the local implementor wrote an abort signal file; the daemon
 * (or next process) will pick it up later. `runs` carries the per-run detail
 * the CLI surfaces in its "abort signal written for N runs:" path.
 */
export type WorkflowAbortResult =
  | { status: "applied"; count: number }
  | {
      status: "signaled";
      runs: { runId: string; workflow: string }[];
    };

/**
 * Result of `workflow.reload`.
 *
 * `applied` means the daemon synchronously reloaded its definitions and
 * `count` is the loaded definition count. `signaled` means no daemon was
 * reachable and a reload signal file was written; the next daemon cycle will
 * pick it up.
 */
export type WorkflowReloadResult =
  | { status: "applied"; count: number }
  | { status: "signaled" };

/** Result of `workflow.enable` / `workflow.disable`. */
export type WorkflowEnableResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

export type WorkflowDisableResult = WorkflowEnableResult;

/** Result of `workflow.cancelRun(id)` for a queued run. */
export type WorkflowCancelRunResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "active" };

/** Result of `workflow.abortRun(id)` for a single active run. */
export type WorkflowAbortRunResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "queued" };

/**
 * Capabilities that require a running daemon. The daemon-down path returns
 * `{ ok: false, reason: "daemon_required" }` so the CLI surfaces the same
 * structured error every time, no ad-hoc null sentinels.
 */
export type WorkflowDaemonRequiredResult = {
  ok: false;
  reason: "daemon_required";
};

/**
 * Result of `workflow.getRun(id)`.
 *
 * Daemon-up: full `WorkflowRunDetail` from in-memory tracker, including live
 * status for an active run. Daemon-down: same shape reconstructed from the run
 * artifact (`metadata.json`); some fields the daemon adds (e.g. `triggerPayload`
 * normalized through the runtime) round-trip through the artifact unchanged.
 */
export type WorkflowGetRunResult =
  | { found: true; run: WorkflowRunDetail }
  | { found: false };

/**
 * Options accepted by `workflow.triggerByName`.
 *
 * The CLI does its own pre-validation (definition exists, enabled, cooldown,
 * already-queued) using `getValidatedWorkflowDefinitions(ctx)` and
 * `workflow.status()`; the contract carries only the enqueue itself. `event`
 * and `runId` mirror the per-trigger fields the daemon already exposes — the
 * CLI's `replay`/`resume-run` paths use them to thread their own trigger label
 * and pinned run id through.
 */
export type WorkflowTriggerOptions = {
  tags?: string[];
  payload?: Record<string, unknown>;
  /** Override cooldown gating when computing notBeforeMs. */
  force?: boolean;
  /** Trigger event label written into the queued run's trigger record. */
  event?: string;
  /** Pinned run id (used by replay/resume to propagate a deterministic id). */
  runId?: string;
  /** Earliest dispatch time for the daemon-down enqueue path (ms epoch). */
  notBeforeMs?: number;
};

/**
 * Result of `workflow.triggerByName`. `path` distinguishes the daemon-applied
 * enqueue (the daemon accepted the trigger and may have started the run
 * immediately) from the daemon-down path (a pending run was appended to the
 * persisted queue and will start on the next daemon cycle). `runId` is the
 * pinned id when the caller supplied one; the daemon may also return its own
 * generated id which the CLI surfaces verbatim.
 */
export type WorkflowTriggerResult =
  | { ok: true; path: "daemon" | "queue"; queued: string; runId?: string }
  | { ok: false; reason: "already_queued" };

/**
 * Result of `workflow.listDefinitions`. `source` carries which side produced
 * the listing so callers can render attribution; the daemon listing includes
 * `runtimeEnabled` overrides while the static listing reflects the definition
 * file as-loaded.
 */
export type WorkflowDefinitionsResult = {
  source: "daemon" | "static";
  definitions: WorkflowDefinitionSummary[];
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
 * Workflow runtime operations.
 *
 * Reads (`listRuns`, `status`) work both daemon-up and daemon-down — the
 * local implementor sources from run artifacts and persisted state.
 * Dispatch-state mutations (`pause`, `resume`, `abort`, `reload`) work
 * daemon-down via signal files: the local implementor writes the signal
 * and the next daemon cycle picks it up. Definition mutations
 * (`enable`, `disable`) and per-run mutations (`cancelRun`, `abortRun`)
 * touch in-memory daemon state and surface `daemon_required` when no
 * daemon is reachable.
 */
export interface WorkflowClient {
  listRuns(filter?: WorkflowRunsListFilter): Promise<WorkflowRunsListResult>;
  status(): Promise<WorkflowStatusSnapshot>;
  /**
   * Look up a single run. Daemon-up consults the daemon's in-memory tracker;
   * daemon-down reads the run artifact under `.kota/runs/`.
   */
  getRun(id: string): Promise<WorkflowGetRunResult>;
  /**
   * Enumerate registered workflow definitions. Daemon-up returns the
   * daemon's runtime view (with `runtimeEnabled` overrides); daemon-down
   * reflects the static definition source as loaded from the workspace.
   */
  listDefinitions(): Promise<WorkflowDefinitionsResult>;
  pause(): Promise<WorkflowPauseResult>;
  resume(): Promise<WorkflowPauseResult>;
  abort(): Promise<WorkflowAbortResult>;
  reload(): Promise<WorkflowReloadResult>;
  /**
   * Enqueue a manual workflow run. Daemon-up posts to the daemon's
   * `/workflow/trigger`; daemon-down appends a pending run to the persisted
   * queue so the next daemon cycle picks it up.
   */
  triggerByName(
    name: string,
    options?: WorkflowTriggerOptions,
  ): Promise<WorkflowTriggerResult>;
  enable(
    name: string,
  ): Promise<WorkflowEnableResult | WorkflowDaemonRequiredResult>;
  disable(
    name: string,
  ): Promise<WorkflowDisableResult | WorkflowDaemonRequiredResult>;
  cancelRun(
    id: string,
  ): Promise<WorkflowCancelRunResult | WorkflowDaemonRequiredResult>;
  abortRun(
    id: string,
  ): Promise<WorkflowAbortRunResult | WorkflowDaemonRequiredResult>;
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

export type SessionsListResult = {
  sessions: InteractiveSession[];
};

/**
 * Result of `sessions.setAutonomyMode`. `serveOwned` indicates the session is
 * registered through `kota serve` rather than owned by the daemon directly;
 * the daemon updates its advisory metadata and returns success, but the
 * authoritative change must reach the owning serve process.
 */
export type SessionsSetAutonomyModeResult =
  | { ok: true; autonomyMode: AutonomyMode; source: "daemon" | "serve"; serveOwned: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "daemon_required" };

/**
 * Loaded-module summary surfaced by `modules.list`.
 *
 * The shape mirrors `ModuleSummary` but is intentionally narrower: only fields
 * an operator browsing the runtime needs to make sense of what is loaded and
 * what each module contributes. Fuller introspection (per-tool listing,
 * full skill bodies) stays on the module-manager CLI/route surface.
 */
export type ModuleListEntry = {
  name: string;
  source: "project" | "installed" | "foreign";
  status: "loaded" | "failed";
  version?: string;
  description?: string;
  toolCount: number;
  workflowCount: number;
  commandCount: number;
  channelCount: number;
  skillCount: number;
  agentCount: number;
  loadError?: string;
};

export type ModulesListResult = {
  modules: ModuleListEntry[];
};

/**
 * Interactive-session operations.
 *
 * `list` enumerates sessions registered with the daemon — both `kota serve`
 * registrations and daemon-owned chat sessions. `setAutonomyMode` mutates a
 * session's supervision posture; daemon-owned sessions update in-place and
 * serve-registered sessions get advisory metadata updated with `serveOwned:
 * true` so the caller knows the authoritative change must reach the owning
 * serve process.
 *
 * Local mode (no daemon reachable) returns an empty session list and
 * surfaces `daemon_required` from `setAutonomyMode` — interactive sessions
 * only exist while a runtime host is alive.
 */
export interface SessionsClient {
  list(): Promise<SessionsListResult>;
  setAutonomyMode(id: string, mode: AutonomyMode): Promise<SessionsSetAutonomyModeResult>;
}

/**
 * Loaded-module operations.
 *
 * `list` returns the runtime view of loaded modules. Daemon mode reports
 * the modules loaded by the daemon process; local mode reports the modules
 * loaded by the CLI process (the same view `kota module list` already
 * exposes). `failed` entries carry the load error so the navigator can
 * show why a module is not available without falling back to log scraping.
 */
export interface ModulesClient {
  list(): Promise<ModulesListResult>;
}

/**
 * A registered agent definition as the CLI surfaces it.
 *
 * `source` carries the contributing module name so the navigator can render
 * attribution. `model` reflects the agent's default after operator overrides
 * from `config.agentModels` are applied — the contract pre-resolves that
 * mapping so no caller has to repeat it. `effort` is required on every
 * `AgentDef`, but the contract types it as optional because some legacy
 * agent definitions surfaced through `getModuleSummaries()` predate the
 * required field; absence renders as the empty string in CLI output.
 */
export type AgentSummary = {
  name: string;
  source: string;
  role: string;
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  promptPath: string;
  writeScope: string[];
  skills?: string[] | "all";
  tools?: AgentToolPolicy;
};

export type AgentsListResult = {
  agents: AgentSummary[];
};

export type AgentInspectResult =
  | { found: true; agent: AgentSummary }
  | { found: false };

/**
 * Agent definition operations.
 *
 * `list` returns every agent contributed by the loaded module set, with the
 * operator's `agentModels` overrides already resolved. `inspect` returns the
 * full detail for a single agent. Both reads work daemon-up and daemon-down;
 * the daemon-side route reflects the daemon's loaded module set, the local
 * handler reflects the CLI's.
 */
export interface AgentsClient {
  list(): Promise<AgentsListResult>;
  inspect(name: string): Promise<AgentInspectResult>;
}

/**
 * A registered skill as the CLI surfaces it. `source` is the contributing
 * module name, or the literal string `"imported"` for skills installed under
 * `.kota/skills/` via `kota skill import`.
 */
export type SkillSummary = {
  name: string;
  source: string;
  description?: string;
  promptPath: string;
  roles?: string[];
};

export type SkillsListResult = {
  skills: SkillSummary[];
};

export type SkillImportOptions = {
  /** Override the skill name (and on-disk filename) declared in frontmatter. */
  name?: string;
};

/**
 * Result of `skills.import`.
 *
 * `fetch_failed` covers HTTP and missing-local-file errors uniformly;
 * `missing_name` fires when the skill source has no `name` frontmatter and
 * the caller passed no override. The CLI maps both to a single error
 * message regardless of which transport answered.
 */
export type SkillImportResult =
  | { ok: true; name: string; path: string }
  | {
      ok: false;
      reason: "fetch_failed" | "missing_name";
      message: string;
    };

/**
 * Skill operations.
 *
 * `list` enumerates every registered skill — module-contributed plus
 * imported — with the contributor name. `import` fetches a skill from a URL
 * or local file and writes it under `.kota/skills/`.
 */
export interface SkillsClient {
  list(): Promise<SkillsListResult>;
  import(source: string, options?: SkillImportOptions): Promise<SkillImportResult>;
}

/** A scenario shipped under `src/modules/harness-parity/scenarios/`. */
export type HarnessParityScenarioSummary = {
  id: string;
  description: string;
};

export type HarnessParityListResult = {
  scenarios: HarnessParityScenarioSummary[];
};

export type HarnessParityRunOptions = {
  /** Restrict to these scenario ids. Empty / omitted runs every scenario. */
  scenarios?: string[];
  /** Restrict to these harness names. Empty / omitted runs every registered harness. */
  harnesses?: string[];
  /** Model identifier passed verbatim to every harness. */
  model?: string;
  /** Upper turn bound for harnesses that iterate. */
  maxTurns?: number;
  /** Override the output directory for paired artifacts. */
  outDir?: string;
  /** Keep the materialized working directories for inspection. */
  keepWorkingDir?: boolean;
};

/** Per-harness-per-scenario summary surfaced by `harnessParity.run`. */
export type HarnessParityArtifactSummary = {
  scenarioId: string;
  harnessName: string;
  passed: boolean;
  isError: boolean;
  turns: number;
  changedFiles: string[];
  artifactDir: string;
};

/**
 * Result of `harnessParity.run`.
 *
 * Errors that surface before the harness loop runs (scenario load, missing
 * scenarios, missing harnesses, invalid `maxTurns`) get a typed reason so
 * the CLI maps each to its existing failure path. Success carries every
 * paired artifact summary plus the resolved `outBaseDir`.
 */
export type HarnessParityRunResult =
  | {
      ok: true;
      outBaseDir: string;
      artifacts: HarnessParityArtifactSummary[];
    }
  | {
      ok: false;
      reason:
        | "scenarios_load_error"
        | "no_scenarios"
        | "no_harnesses"
        | "invalid_max_turns";
      message: string;
    };

/**
 * Harness-parity operations.
 *
 * `list` enumerates the scenarios shipped under
 * `src/modules/harness-parity/scenarios/`. `run` materializes each scenario
 * across every requested harness and returns the resulting paired-artifact
 * summary; the artifacts themselves land on disk under `outBaseDir`.
 */
export interface HarnessParityClient {
  list(): Promise<HarnessParityListResult>;
  run(options?: HarnessParityRunOptions): Promise<HarnessParityRunResult>;
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
  readonly knowledge: KnowledgeClient;
  readonly sessions: SessionsClient;
  readonly modules: ModulesClient;
  readonly agents: AgentsClient;
  readonly skills: SkillsClient;
  readonly harnessParity: HarnessParityClient;
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
  "knowledge",
  "sessions",
  "modules",
  "agents",
  "skills",
  "harnessParity",
] as const satisfies ReadonlyArray<keyof KotaClient>;

export type KotaClientNamespace = (typeof KOTA_CLIENT_NAMESPACES)[number];

/** Local-side handler bundle: one namespace impl per declared capability. */
export type LocalClientHandlers = {
  [K in KotaClientNamespace]: KotaClient[K];
};
