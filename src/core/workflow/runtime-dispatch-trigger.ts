import { formatChildRunId } from "./run-io.js";
import type { WorkflowStepResult } from "./run-types.js";
import type { WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

export type TriggerWorkflowFromStepResult = {
  runId: string;
  status: "queued" | "completed" | "failed";
  childOutput?: WorkflowStepResult["output"];
};

export async function triggerWorkflowFromStep(
  state: WorkflowRuntimeDispatchState,
  parentRunId: string,
  workflowName: string,
  payload: WorkflowRunTrigger["payload"],
  waitFor: "queued" | "completed",
  signal?: AbortSignal,
  triggerId?: string,
  event = "workflow.triggered",
): Promise<TriggerWorkflowFromStepResult> {
  const definition = state.definitions.find((item) => item.name === workflowName);
  if (!definition) {
    throw new Error(`Trigger step references unknown workflow "${workflowName}"`);
  }
  if (!definition.enabled) {
    throw new Error(`Trigger step references disabled workflow "${workflowName}"`);
  }

  if (!triggerId) throw new Error("Child workflow trigger identity is required");
  const requestedRunId = formatChildRunId(parentRunId, triggerId, workflowName);
  const now = Date.now();
  const runTrigger: WorkflowRunTrigger = {
    event,
    schemaRef: null,
    payload: {
      ...payload,
      _runId: requestedRunId,
      triggeredByRunId: parentRunId,
    },
  };
  const admission = state.wfQueue.appendRun({
    runId: requestedRunId,
    workflowName,
    trigger: runTrigger,
    enqueuedAtMs: now,
    notBeforeMs: now,
  });
  if (!admission) {
    throw new Error(`Child workflow "${workflowName}" could not be admitted`);
  }
  const runId = admission.runId;
  if (waitFor === "queued") return { runId, status: "queued" };

  const child = await state.runCoordinator.waitForChild(
    parentRunId,
    runId,
    signal ?? new AbortController().signal,
  );
  const childMeta = state.store.getRun(runId);
  const childOutput = childMeta?.steps
    .slice()
    .reverse()
    .find((step) => step.status === "success")?.output;
  return {
    runId,
    status: child.state === "succeeded" ? "completed" : "failed",
    ...(childOutput !== undefined ? { childOutput } : {}),
  };
}
