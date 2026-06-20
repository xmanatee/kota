import type { ModuleEventRegistration } from "#core/events/module-event.js";
import { getModuleEventRegistry } from "#core/events/module-event.js";
import type {
  WorkflowBatchTrigger,
  WorkflowTrigger,
} from "#core/workflow/trigger-types.js";
import type {
  AutomationBatchSummary,
  AutomationSchemaSummary,
  AutomationTriggerSummary,
} from "./types.js";

function filterString(filter: WorkflowTrigger["filter"]): string | undefined {
  if (!filter || Object.keys(filter).length === 0) return undefined;
  return Object.entries(filter)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(",");
}

function batchSummary(batch: WorkflowBatchTrigger): AutomationBatchSummary {
  return {
    ...(batch.maxCount !== undefined ? { maxCount: batch.maxCount } : {}),
    ...(batch.maxAgeMs !== undefined ? { maxAgeMs: batch.maxAgeMs } : {}),
    ...(batch.idleTimeoutMs !== undefined ? { idleTimeoutMs: batch.idleTimeoutMs } : {}),
    groupBy: batch.groupBy,
    ...(batch.flushEvent !== undefined ? { flushEvent: batch.flushEvent } : {}),
    maxBufferSize: batch.maxBufferSize,
    overflow: batch.overflow,
  };
}

function schemaSummaryForEvent(
  eventName: string,
  trigger?: WorkflowTrigger,
): AutomationSchemaSummary | undefined {
  const registered = getModuleEventRegistry()?.get(eventName);
  if (registered) return schemaSummaryFromRegistration(registered);
  if (trigger?.schemaVersion === undefined) return undefined;
  return {
    name: eventName,
    version: trigger.schemaVersion,
    declared: false,
    filterablePaths: [],
  };
}

export function schemaSummaryFromRegistration(
  registration: ModuleEventRegistration,
): AutomationSchemaSummary {
  return {
    name: registration.name,
    version: registration.currentVersion,
    declared: true,
    scope: registration.scope,
    module: registration.module,
    sensitivity: registration.sensitivity,
    filterablePaths: registration.filterablePaths,
    payloadSchema: registration.payloadSchema,
  };
}

export function automationTriggerSummary(
  trigger: WorkflowTrigger,
  index: number,
): AutomationTriggerSummary {
  return {
    index,
    event: trigger.event,
    schema: schemaSummaryForEvent(trigger.event, trigger),
    filter: filterString(trigger.filter),
    cooldownMs: trigger.cooldownMs,
    ...(trigger.batch ? { batch: batchSummary(trigger.batch) } : {}),
    policies: [
      {
        kind: "idempotency",
        source: "workflow-dispatch",
        outcome: "unknown",
        reason: "dispatch idempotency is resolved at enqueue time from eventId, idempotencyKey, or batch input events",
      },
    ],
  };
}
