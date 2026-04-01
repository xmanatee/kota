import { matchesGlob } from "node:path";
import { validateCronExpr } from "./cron.js";
import type { WorkflowTrigger, WorkflowTriggerInput } from "./types.js";
import {
  expectNonEmptyString,
  expectOptionalInteger,
  expectOptionalScalarFilter,
  WorkflowDefinitionError,
} from "./validation-primitives.js";

const MIN_DEBOUNCE_MS = 200;
const DEFAULT_DEBOUNCE_MS = 500;

/** Validates that a glob pattern is syntactically usable. */
function validateGlobPattern(pattern: string, field: string, definitionPath: string): void {
  if (!pattern || typeof pattern !== "string") {
    throw new WorkflowDefinitionError(`${field} must be a non-empty string`, definitionPath);
  }
  // Test the pattern by running it against an empty string — this exercises the
  // path.matchesGlob implementation and surfaces malformed patterns.
  try {
    matchesGlob("", pattern);
  } catch {
    throw new WorkflowDefinitionError(`${field}: invalid glob pattern "${pattern}"`, definitionPath);
  }
}

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

  if (trigger.watch != null) {
    if (trigger.event != null || trigger.filter != null || trigger.schedule != null || trigger.intervalMs != null || trigger.webhook === true) {
      throw new WorkflowDefinitionError(
        `triggers[${index}]: watch triggers do not support event, filter, schedule, intervalMs, or webhook`,
        definitionPath,
      );
    }
    const patterns = Array.isArray(trigger.watch) ? trigger.watch : [trigger.watch];
    if (patterns.length === 0) {
      throw new WorkflowDefinitionError(
        `triggers[${index}].watch must be a non-empty string or array`,
        definitionPath,
      );
    }
    for (let i = 0; i < patterns.length; i++) {
      validateGlobPattern(patterns[i], `triggers[${index}].watch[${i}]`, definitionPath);
    }
    const debounceMs =
      expectOptionalInteger(trigger.debounceMs, `triggers[${index}].debounceMs`, definitionPath, MIN_DEBOUNCE_MS)
      ?? DEFAULT_DEBOUNCE_MS;
    if (debounceMs < MIN_DEBOUNCE_MS) {
      throw new WorkflowDefinitionError(
        `triggers[${index}].debounceMs must be at least ${MIN_DEBOUNCE_MS}ms`,
        definitionPath,
      );
    }
    return { event: "files.changed", cooldownMs: 0, watch: patterns, debounceMs };
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
