import type { WorkflowEnqueueOptions } from "./operator-trigger.js";
import { formatRunId } from "./run-io.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

export function buildRetriggerOptions(
  mode: "retry" | "replay",
  sourceRunId: string,
  workflowName: string,
  original: WorkflowRunTrigger,
): WorkflowEnqueueOptions {
  const runId = formatRunId(workflowName);
  const {
    _runId: _discardRunId,
    triggeredAt: _discardTriggeredAt,
    retryOf: _discardRetryOf,
    replayOf: _discardReplayOf,
    replayTriggeredAt: _discardReplayTriggeredAt,
    resumedFromRunId: _discardResumedFromRunId,
    resumeFromStep: _discardResumeFromStep,
    resumeTriggeredAt: _discardResumeTriggeredAt,
    ...payload
  } = original.payload;

  return {
    event: original.event,
    schemaRef: original.schemaRef,
    runId,
    payload: {
      ...payload,
      idempotencyKey: `${mode}:${sourceRunId}:${runId}`,
      ...(mode === "retry" ? { retryOf: sourceRunId } : { replayOf: sourceRunId }),
    },
  };
}
