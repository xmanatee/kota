import { formatRunId } from "./run-io.js";
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
  startNext: () => void,
  workflowName: string,
  payload: WorkflowRunTrigger["payload"],
  waitFor: "queued" | "completed",
  signal?: AbortSignal,
): Promise<TriggerWorkflowFromStepResult> {
  const definition = state.definitions.find((item) => item.name === workflowName);
  if (!definition) {
    throw new Error(`Trigger step references unknown workflow "${workflowName}"`);
  }
  if (!definition.enabled) {
    throw new Error(`Trigger step references disabled workflow "${workflowName}"`);
  }

  const runId = formatRunId(workflowName);
  const now = Date.now();
  const runTrigger: WorkflowRunTrigger = {
    event: "workflow.triggered",
    schemaRef: null,
    payload: { ...payload, _runId: runId, triggeredAt: new Date().toISOString() },
  };

  if (waitFor === "queued") {
    const runtimeState = state.store.readState();
    state.store.setPendingRuns([
      ...runtimeState.pendingRuns,
      { runId, workflowName, trigger: runTrigger, enqueuedAtMs: now, notBeforeMs: now },
    ]);
    startNext();
    return { runId, status: "queued" };
  }

  return new Promise((resolve, reject) => {
    const stopListening = state.runtimeConfig.bus.on(
      "workflow.completed",
      (completedPayload) => {
        if (completedPayload.runId !== runId) return;
        stopListening();
        const status =
          completedPayload.status === "success" ||
          completedPayload.status === "completed-with-warnings"
            ? "completed"
            : "failed";
        const childMeta = state.store.getRun(runId);
        const lastSuccessfulStep = childMeta?.steps
          .slice()
          .reverse()
          .find((step) => step.status === "success");
        const childOutput = lastSuccessfulStep?.output;
        resolve({ runId, status, ...(childOutput !== undefined && { childOutput }) });
      },
    );

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          stopListening();
          const reason =
            signal.reason instanceof Error
              ? signal.reason
              : new Error("Trigger step aborted");
          reject(reason);
        },
        { once: true },
      );
    }

    const runtimeState = state.store.readState();
    state.store.setPendingRuns([
      ...runtimeState.pendingRuns,
      { runId, workflowName, trigger: runTrigger, enqueuedAtMs: now, notBeforeMs: now },
    ]);
    startNext();
  });
}
