import type { ScopeSelector } from "#core/server/scope-selector.js";
import type { KnowledgeDeleteResult } from "#modules/knowledge/client.js";
import type { MemoryDeleteResult } from "#modules/memory/client.js";
import type { RepoTaskMoveResult } from "#modules/repo-tasks/client.js";
import type { RepoTaskInboxRetractionResult } from "#modules/repo-tasks/repo-task-mutation-boundary.js";

export type RetractTarget = "memory" | "knowledge" | "tasks" | "inbox";

/** One identifier shape for every surface; the selected store interprets it. */
export type RetractRequest = ScopeSelector & {
  target: RetractTarget;
  identifier: string;
};

type TaggedRetractResult<TTarget extends RetractTarget, TResult> =
  TResult extends unknown
    ? Readonly<{ target: TTarget; identifier: string } & TResult>
    : never;

type RetractMemorySuccess = TaggedRetractResult<
  "memory",
  Extract<MemoryDeleteResult, { ok: true }>
>;
type RetractMemoryFailure = TaggedRetractResult<
  "memory",
  Extract<MemoryDeleteResult, { ok: false }>
>;
export type RetractMemoryResult = RetractMemorySuccess | RetractMemoryFailure;

type RetractKnowledgeSuccess = TaggedRetractResult<
  "knowledge",
  Extract<KnowledgeDeleteResult, { ok: true }>
>;
type RetractKnowledgeFailure = TaggedRetractResult<
  "knowledge",
  Extract<KnowledgeDeleteResult, { ok: false }>
>;
export type RetractKnowledgeResult =
  | RetractKnowledgeSuccess
  | RetractKnowledgeFailure;

type RetractTasksSuccess = TaggedRetractResult<
  "tasks",
  Extract<RepoTaskMoveResult, { ok: true }> & { toState: "dropped" }
>;
type RetractTasksInvalidId = TaggedRetractResult<
  "tasks",
  Extract<RepoTaskMoveResult, { ok: false; reason: "invalid_id" }>
>;
type RetractTasksNotFound = TaggedRetractResult<
  "tasks",
  Extract<RepoTaskMoveResult, { ok: false; reason: "not_found" }>
>;
type RetractTasksAlreadyDropped = TaggedRetractResult<
  "tasks",
  Extract<RepoTaskMoveResult, { ok: false; reason: "already_in_state" }>
>;
export type RetractTasksResult =
  | RetractTasksSuccess
  | RetractTasksInvalidId
  | RetractTasksNotFound
  | RetractTasksAlreadyDropped;

type RetractInboxSuccess = TaggedRetractResult<
  "inbox",
  Extract<RepoTaskInboxRetractionResult, { ok: true }>
>;
type RetractInboxFailure = TaggedRetractResult<
  "inbox",
  Extract<RepoTaskInboxRetractionResult, { ok: false }>
>;
export type RetractInboxResult = RetractInboxSuccess | RetractInboxFailure;

export type RetractResult =
  | RetractMemorySuccess
  | RetractMemoryFailure
  | RetractKnowledgeSuccess
  | RetractKnowledgeFailure
  | RetractTasksSuccess
  | RetractTasksInvalidId
  | RetractTasksNotFound
  | RetractTasksAlreadyDropped
  | RetractInboxSuccess
  | RetractInboxFailure
  | Readonly<{
      ok: false;
      reason: "retract_failed";
      target: RetractTarget;
      identifier: string;
      message: string;
    }>;

export interface RetractClient {
  retract(request: RetractRequest): Promise<RetractResult>;
}
