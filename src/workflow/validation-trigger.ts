import { validateCronExpr } from "./cron.js";
import type { WorkflowTrigger, WorkflowTriggerInput } from "./types.js";
import {
  expectNonEmptyString,
  expectOptionalInteger,
  expectOptionalScalarFilter,
  WorkflowDefinitionError,
} from "./validation-primitives.js";

export function validateTrigger(
  trigger: WorkflowTriggerInput,
  definitionPath: string,
  index: number,
): WorkflowTrigger {
  if (!trigger || typeof trigger !== "object") {
    throw new WorkflowDefinitionError(
      `triggers[${index}] must be an object`,
      definitionPath,
    );
  }

  if (trigger.webhook === true) {
    if (trigger.event != null || trigger.filter != null || trigger.schedule != null || trigger.intervalMs != null) {
      throw new WorkflowDefinitionError(
        `triggers[${index}]: webhook triggers do not support event, filter, schedule, or intervalMs`,
        definitionPath,
      );
    }
    return { event: "webhook", cooldownMs: 0, webhook: true };
  }

  const isSchedule = trigger.schedule != null || trigger.intervalMs != null;

  if (isSchedule && trigger.filter != null) {
    throw new WorkflowDefinitionError(
      `triggers[${index}]: schedule triggers do not support filter`,
      definitionPath,
    );
  }

  if (trigger.schedule != null && trigger.intervalMs != null) {
    throw new WorkflowDefinitionError(
      `triggers[${index}]: specify either schedule or intervalMs, not both`,
      definitionPath,
    );
  }

  const event = isSchedule
    ? (trigger.event ?? "schedule")
    : expectNonEmptyString(trigger.event, `triggers[${index}].event`, definitionPath);

  const cooldownMs =
    expectOptionalInteger(
      trigger.cooldownMs,
      `triggers[${index}].cooldownMs`,
      definitionPath,
      0,
    ) ?? 0;

  if (trigger.schedule != null) {
    if (typeof trigger.schedule !== "string" || !trigger.schedule.trim()) {
      throw new WorkflowDefinitionError(
        `triggers[${index}].schedule must be a non-empty string`,
        definitionPath,
      );
    }
    const cronError = validateCronExpr(trigger.schedule);
    if (cronError) {
      throw new WorkflowDefinitionError(
        `triggers[${index}].schedule: ${cronError}`,
        definitionPath,
      );
    }
    return { event, cooldownMs, schedule: trigger.schedule };
  }

  if (trigger.intervalMs != null) {
    const intervalMs = expectOptionalInteger(
      trigger.intervalMs,
      `triggers[${index}].intervalMs`,
      definitionPath,
      1,
    );
    if (!intervalMs || intervalMs < 1000) {
      throw new WorkflowDefinitionError(
        `triggers[${index}].intervalMs must be at least 1000ms`,
        definitionPath,
      );
    }
    return { event, cooldownMs, intervalMs };
  }

  return {
    event,
    filter: expectOptionalScalarFilter(
      trigger.filter,
      `triggers[${index}].filter`,
      definitionPath,
    ),
    cooldownMs,
  };
}
