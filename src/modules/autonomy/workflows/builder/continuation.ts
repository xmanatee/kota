import type { WorkflowContinuationContext } from "#core/workflow/continuation.js";
import type { WorkflowRepairLoopConfig } from "#core/workflow/run-types.js";
import {
  autonomyContinuationPolicy,
  collectAutonomyContinuationContext,
} from "#modules/autonomy/continuation.js";
import type { RepoTaskPriority } from "#modules/repo-tasks/repo-tasks-domain.js";

type BuilderContinuationContextInput = Readonly<{
  scopeRoot: string;
  taskId: string;
  priority: string;
  taskContract: string;
}>;

function readPriority(priority: string): RepoTaskPriority {
  if (
    priority !== "p0" &&
    priority !== "p1" &&
    priority !== "p2" &&
    priority !== "p3"
  ) {
    throw new Error(`Unknown continuation priority "${priority}"`);
  }
  return priority;
}

export function collectBuilderContinuationContext(
  input: BuilderContinuationContextInput,
): WorkflowContinuationContext {
  return collectAutonomyContinuationContext({
    scopeRoot: input.scopeRoot,
    id: input.taskId,
    priority: readPriority(input.priority),
    taskContract: input.taskContract,
  });
}

export function builderContinuationPolicy(): NonNullable<
  WorkflowRepairLoopConfig["continuation"]
> {
  return autonomyContinuationPolicy({
    decompositionSupported: true,
    resolveSubject: (ctx) => ({
      id: String(ctx.trigger.payload.taskId),
      priority: readPriority(String(ctx.trigger.payload.priority)),
      taskContract: String(ctx.trigger.payload.taskContract),
    }),
  });
}
