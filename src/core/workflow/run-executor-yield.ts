import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import { type ActiveTimeout, activeTimingMetadata } from "./active-timeout.js";
import { buildWorkflowCompletedPayload } from "./event-payloads.js";
import type { RepairLoopYield } from "./repair-loop-types.js";
import type { RunExecutorDeps } from "./run-executor-deps.js";
import type { WorkflowRunExecutionResult } from "./run-types.js";
import type { WorkflowDefinition } from "./types.js";

export function finishYieldedWorkflowRun(args: {
  definition: WorkflowDefinition;
  signal: RepairLoopYield;
  run: Pick<ActiveWorkflowRunHandle, "finish">;
  runTimeout: ActiveTimeout | undefined;
  startedAt: number;
  deps: Pick<Required<RunExecutorDeps>, "pbus" | "log">;
}): WorkflowRunExecutionResult {
  const timing = args.runTimeout?.snapshot();
  args.runTimeout?.dispose();
  const completed = args.run.finish({
    status: "yielded",
    durationMs: Date.now() - args.startedAt,
    ...activeTimingMetadata(timing),
  });
  args.deps.pbus.emit(
    "workflow.completed",
    buildWorkflowCompletedPayload(
      completed,
      "yielded",
      args.definition.tags,
      undefined,
      args.definition.defaultAutonomyMode,
    ),
  );
  args.deps.log(
    `Yielded workflow "${args.definition.name}" (${completed.id}): ${args.signal.decision.summary}`,
  );
  return { metadata: completed };
}
