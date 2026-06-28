import {
  createBatchDeadLetter,
  createWorkflowDispatchDeadLetter,
  type DeadLetterQueueStore,
} from "#core/daemon/dead-letter-queue.js";
import { validatePayloadSchema } from "./payload-validator.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchFlushPayload,
  type WorkflowRunTrigger,
} from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export function rejectInvalidTriggerPayload(input: {
  definition: WorkflowDefinition;
  trigger: WorkflowRunTrigger;
  deadLetterQueue?: DeadLetterQueueStore;
  scopeId: string;
  log: (message: string) => void;
}): boolean {
  if (!input.definition.inputSchema) return false;
  const schemaError = validatePayloadSchema(
    input.definition.inputSchema,
    input.trigger.payload,
  );
  if (!schemaError) return false;
  input.log(
    `Rejected trigger for workflow "${input.definition.name}": payload validation failed: ${schemaError}`,
  );
  if (!input.deadLetterQueue) return true;
  if (input.trigger.event === WORKFLOW_BATCH_FLUSH_EVENT) {
    createBatchDeadLetter({
      store: input.deadLetterQueue,
      scopeId: input.scopeId,
      payload: input.trigger.payload as WorkflowBatchFlushPayload,
      reason: schemaError,
      errorClass: "validation",
      trigger: input.trigger,
    });
    return true;
  }
  createWorkflowDispatchDeadLetter({
    store: input.deadLetterQueue,
    scopeId: input.scopeId,
    workflowName: input.definition.name,
    trigger: input.trigger,
    reason: schemaError,
    errorClass: "validation",
    owningModule: "workflow-runtime",
  });
  return true;
}
