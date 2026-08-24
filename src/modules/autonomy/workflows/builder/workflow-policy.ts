import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { stepCommitted } from "#modules/autonomy/shared.js";
import { mergeGateSucceeded } from "./merge-gate-step.js";
import type { BuilderWorkspaceResult } from "./prepare-worktree-step.js";

export function builderCommitPublished(ctx: WorkflowStepContext): boolean {
  if (!stepCommitted("commit")(ctx)) return false;
  const workspace = ctx.stepOutputs["prepare-worktree"] as
    | BuilderWorkspaceResult
    | undefined;
  return workspace?.enabled !== true || mergeGateSucceeded(ctx);
}
