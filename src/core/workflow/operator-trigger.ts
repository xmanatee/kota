import type {
  EventPayloadRecord,
  EventSchemaReference,
} from "#core/events/event-bus-types.js";
import { formatRunId, validateWorkflowRunId } from "./run-io.js";
import type { WorkflowQueuedRun } from "./run-types.js";

export type WorkflowEnqueueOptions = {
  tags?: string[];
  payload?: EventPayloadRecord;
  event?: string;
  schemaRef?: EventSchemaReference | null;
  runId?: string;
  notBeforeMs?: number;
};

export type OperatorTriggerRequestBody = WorkflowEnqueueOptions & {
  name: string;
};

export function buildOperatorTriggerRequestBody(
  workflowName: string,
  options: WorkflowEnqueueOptions | undefined,
): OperatorTriggerRequestBody {
  return {
    name: workflowName,
    ...(options?.tags?.length ? { tags: options.tags } : {}),
    ...(options?.payload && Object.keys(options.payload).length > 0
      ? { payload: options.payload }
      : {}),
    ...(options?.event !== undefined ? { event: options.event } : {}),
    ...(options?.schemaRef !== undefined ? { schemaRef: options.schemaRef } : {}),
    ...(options?.runId !== undefined ? { runId: options.runId } : {}),
    ...(options?.notBeforeMs !== undefined ? { notBeforeMs: options.notBeforeMs } : {}),
  };
}

export function buildOperatorQueuedRun(
  workflowName: string,
  options: WorkflowEnqueueOptions = {},
  nowMs = Date.now(),
): WorkflowQueuedRun {
  const runId = options.runId === undefined
    ? formatRunId(workflowName)
    : validateWorkflowRunId(options.runId, `Workflow "${workflowName}" enqueue`);
  const event = options.event ?? "manual";
  if (event.trim().length === 0) {
    throw new Error(`Workflow "${workflowName}" trigger event must be non-empty`);
  }
  const payload = { ...(options.payload ?? {}) };
  delete payload._runId;

  return {
    runId,
    workflowName,
    trigger: {
      event,
      schemaRef: options.schemaRef ?? null,
      payload: {
        ...payload,
        triggeredAt: new Date(nowMs).toISOString(),
        ...(options.tags?.length ? { tags: options.tags } : {}),
      },
    },
    enqueuedAtMs: nowMs,
    notBeforeMs: options.notBeforeMs ?? nowMs,
  };
}
