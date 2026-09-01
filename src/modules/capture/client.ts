import type { ScopeSelector } from "#core/server/scope-selector.js";
import type { KnowledgeAddResult } from "#modules/knowledge/client.js";
import type { MemoryAddResult } from "#modules/memory/client.js";
import type {
  RepoTaskCaptureResult,
  RepoTaskCreateResult,
} from "#modules/repo-tasks/client.js";

export type CaptureTarget = "memory" | "knowledge" | "tasks" | "inbox";

export type CaptureFilter = ScopeSelector & {
  target?: CaptureTarget;
  hint?: string;
};

type TaggedCaptureResult<TTarget extends CaptureTarget, TResult> =
  TResult extends unknown ? Readonly<{ target: TTarget } & TResult> : never;

/** Direct store outcomes tagged only with the cross-store destination. */
export type CaptureMemoryResult = TaggedCaptureResult<
  "memory",
  { ok: true } & MemoryAddResult
>;
export type CaptureKnowledgeResult = TaggedCaptureResult<
  "knowledge",
  { ok: true } & KnowledgeAddResult
>;
type CaptureTasksSuccess = TaggedCaptureResult<
  "tasks",
  Extract<RepoTaskCreateResult, { ok: true }>
>;
type CaptureTasksFailure = TaggedCaptureResult<
  "tasks",
  Extract<RepoTaskCreateResult, { ok: false }>
>;
export type CaptureTasksResult = CaptureTasksSuccess | CaptureTasksFailure;

type CaptureInboxSuccess = TaggedCaptureResult<
  "inbox",
  Extract<RepoTaskCaptureResult, { ok: true }>
>;
type CaptureInboxFailure = TaggedCaptureResult<
  "inbox",
  Extract<RepoTaskCaptureResult, { ok: false }>
>;
export type CaptureInboxResult = CaptureInboxSuccess | CaptureInboxFailure;

export type CaptureResult =
  | CaptureMemoryResult
  | CaptureKnowledgeResult
  | CaptureTasksSuccess
  | CaptureTasksFailure
  | CaptureInboxSuccess
  | CaptureInboxFailure
  | Readonly<{
      ok: false;
      reason: "ambiguous";
      suggestions: ReadonlyArray<CaptureTarget>;
    }>
  | Readonly<{
      ok: false;
      reason: "write_failed";
      target: CaptureTarget;
      message: string;
    }>;

export interface CaptureClient {
  capture(text: string, filter?: CaptureFilter): Promise<CaptureResult>;
}
