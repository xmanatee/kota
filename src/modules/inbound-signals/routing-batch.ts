import type { WorkflowBatchTrigger } from "#core/workflow/trigger-types.js";
import type { InboundSignalJsonObject } from "./events.js";
import {
  DEFAULT_BATCH_MAX_BUFFER_SIZE,
  DEFAULT_BATCH_OVERFLOW,
} from "./routing-constants.js";
import type {
  InboundSignalBatchPolicy,
  InboundSignalProcessingPolicy,
  InboundSignalRouteMatchField,
} from "./routing-types.js";

export function effectiveMaxBufferSize(batch: InboundSignalBatchPolicy): number {
  if (batch.maxBufferSize !== undefined) return batch.maxBufferSize;
  return Math.max(batch.maxItems ?? 0, DEFAULT_BATCH_MAX_BUFFER_SIZE);
}

export function batchPolicyJson(
  batch: InboundSignalBatchPolicy | undefined,
): InboundSignalJsonObject | null {
  if (!batch) return null;
  const out: {
    mode: "workflow-trigger";
    maxItems?: number;
    maxAgeMs?: number;
    idleMs?: number;
    maxBufferSize: number;
    overflow: "drop-newest" | "flush-oldest";
    groupBy?: readonly InboundSignalRouteMatchField[];
  } = {
    mode: batch.mode,
    maxBufferSize: effectiveMaxBufferSize(batch),
    overflow: batch.overflow ?? DEFAULT_BATCH_OVERFLOW,
  };
  if (batch.maxItems !== undefined) out.maxItems = batch.maxItems;
  if (batch.maxAgeMs !== undefined) out.maxAgeMs = batch.maxAgeMs;
  if (batch.idleMs !== undefined) out.idleMs = batch.idleMs;
  if (batch.groupBy !== undefined) out.groupBy = batch.groupBy;
  return out;
}

export function workflowBatchTrigger(
  batch: InboundSignalBatchPolicy,
): WorkflowBatchTrigger {
  return {
    ...(batch.maxItems !== undefined ? { maxCount: batch.maxItems } : {}),
    ...(batch.maxAgeMs !== undefined ? { maxAgeMs: batch.maxAgeMs } : {}),
    ...(batch.idleMs !== undefined ? { idleTimeoutMs: batch.idleMs } : {}),
    groupBy: batch.groupBy ?? [],
    maxBufferSize: effectiveMaxBufferSize(batch),
    overflow: batch.overflow ?? DEFAULT_BATCH_OVERFLOW,
  };
}

export function processingPolicyJson(
  processing: InboundSignalProcessingPolicy | undefined,
): InboundSignalJsonObject | null {
  if (!processing) return null;
  const out: {
    classifier?: "none" | "cheap";
    modelTier?: "fast" | "balanced" | "capable";
    allowNonReadActions?: boolean;
  } = {};
  if (processing.classifier !== undefined) out.classifier = processing.classifier;
  if (processing.modelTier !== undefined) out.modelTier = processing.modelTier;
  if (processing.allowNonReadActions !== undefined) {
    out.allowNonReadActions = processing.allowNonReadActions;
  }
  return out;
}
