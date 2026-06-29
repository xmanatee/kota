import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  expectStructuredOutput,
  type TypedCodeStepInput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import { stepCommitted, stepSucceeded } from "#modules/autonomy/shared.js";
import type { BuilderWorkspaceResult } from "./prepare-worktree-step.js";
import {
  cleanupBuilderRuntimeResources,
  type BuilderRuntimeResourceCleanupResult,
} from "./runtime-resources.js";

function preparedWorkspace(
  ctx: Pick<WorkflowStepContext, "stepOutputs">,
): BuilderWorkspaceResult | undefined {
  return ctx.stepOutputs["prepare-worktree"] as BuilderWorkspaceResult | undefined;
}

export function createCleanupBuilderRuntimeResourcesStep(): TypedCodeStepInput<
  BuilderRuntimeResourceCleanupResult
> {
  return typedCodeStep<BuilderRuntimeResourceCleanupResult>({
    id: "cleanup-builder-runtime-resources",
    type: "code",
    when: (ctx) => {
      const workspace = preparedWorkspace(ctx);
      if (!workspace?.runtimeResources) return false;
      if (!stepCommitted("commit")(ctx)) return false;
      return (
        stepSucceeded("release-task-claim")(ctx) ||
        stepSucceeded("mark-claim-pending-merge")(ctx)
      );
    },
    validate: (raw) =>
      expectStructuredOutput<BuilderRuntimeResourceCleanupResult>(raw, [
        "schemaVersion",
        "profileId",
        "taskId",
        "runId",
        "workspaceDir",
        "tempRoot",
        "tempRemoved",
        "blockers",
        "portLease",
        "artifactPath",
      ]),
    run: (ctx) => {
      const workspace = preparedWorkspace(ctx);
      if (!workspace?.runtimeResources) {
        throw new Error(
          "Cannot cleanup builder runtime resources without a prepared runtime profile",
        );
      }
      return cleanupBuilderRuntimeResources(workspace.runtimeResources);
    },
  });
}
