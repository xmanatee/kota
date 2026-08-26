import { matchesGlob } from "node:path";
import { getModuleEventRegistry } from "#core/events/module-event.js";
import { validateCronExpr, validateTimezone } from "./cron.js";
import type {
  WorkflowBatchOverflowPolicy,
  WorkflowBatchTrigger,
  WorkflowBatchTriggerInput,
  WorkflowScheduledPayload,
  WorkflowScheduledPayloadValue,
  WorkflowTrigger,
  WorkflowTriggerInput,
  WorkflowTriggerRunOn,
} from "./trigger-types.js";
import {
  expectNonEmptyString,
  expectOptionalInteger,
  expectOptionalScalarFilter,
  WorkflowDefinitionError,
} from "./validation-primitives.js";

const MIN_DEBOUNCE_MS = 200;
const DEFAULT_DEBOUNCE_MS = 500;
const BATCH_OVERFLOW_POLICIES: readonly WorkflowBatchOverflowPolicy[] = [
  "drop-newest",
  "flush-oldest",
];
const RUN_ON_VALUES: readonly WorkflowTriggerRunOn[] = [
  "every-scope",
  "default-scope",
];
const QUEUE_MODE_VALUES = new Set<string>(["latest", "all"]);
const RESERVED_SCHEDULE_PAYLOAD_KEYS = new Set(["scheduledAt"]);

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

function validateScheduledPayloadValue(
  value: WorkflowScheduledPayloadValue,
  field: string,
  definitionPath: string,
): WorkflowScheduledPayloadValue {
  if (value === null) return value;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new WorkflowDefinitionError(
    `${field} must be a string, finite number, boolean, or null`,
    definitionPath,
  );
}

function validateScheduledPayload(
  payload: WorkflowTriggerInput["payload"],
  field: string,
  definitionPath: string,
): WorkflowScheduledPayload | undefined {
  if (payload === undefined) return undefined;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WorkflowDefinitionError(`${field} must be an object`, definitionPath);
  }
  const validated: { [key: string]: WorkflowScheduledPayloadValue } = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.trim().length === 0) {
      throw new WorkflowDefinitionError(`${field} keys must be non-empty`, definitionPath);
    }
    if (RESERVED_SCHEDULE_PAYLOAD_KEYS.has(key)) {
      throw new WorkflowDefinitionError(
        `${field}.${key} is reserved by the scheduler`,
        definitionPath,
      );
    }
    validated[key] = validateScheduledPayloadValue(
      value,
      `${field}.${key}`,
      definitionPath,
    );
  }
  return validated;
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
  const queueMode = trigger.queueMode;
  if (queueMode !== undefined) {
    if (
      typeof queueMode !== "string" ||
      !QUEUE_MODE_VALUES.has(queueMode)
    ) {
      throw new WorkflowDefinitionError(
        `triggers[${index}].queueMode must be "latest" or "all"`,
        definitionPath,
      );
    }
  }

  if (trigger.watch != null) {
    if (
      trigger.event != null ||
      trigger.filter != null ||
      trigger.batch != null ||
      trigger.schedule != null ||
      trigger.intervalMs != null ||
      trigger.runOn != null ||
      trigger.payload != null ||
      trigger.schemaVersion != null ||
      trigger.webhook === true
    ) {
      throw new WorkflowDefinitionError(
        `triggers[${index}]: watch triggers do not support event, filter, batch, schedule, intervalMs, runOn, payload, schemaVersion, or webhook`,
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
    return {
      event: "files.changed",
      cooldownMs: 0,
      watch: patterns,
      debounceMs,
      ...(queueMode !== undefined ? { queueMode } : {}),
    };
  }

  if (trigger.webhook === true) {
    if (
      trigger.event != null ||
      trigger.filter != null ||
      trigger.batch != null ||
      trigger.schedule != null ||
      trigger.intervalMs != null ||
      trigger.runOn != null ||
      trigger.payload != null ||
      trigger.schemaVersion != null
    ) {
      throw new WorkflowDefinitionError(
        `triggers[${index}]: webhook triggers do not support event, filter, batch, schedule, intervalMs, runOn, payload, or schemaVersion`,
        definitionPath,
      );
    }
    return {
      event: "webhook",
      cooldownMs: 0,
      webhook: true,
      ...(queueMode !== undefined ? { queueMode } : {}),
    };
  }

  const isSchedule = trigger.schedule != null || trigger.intervalMs != null;

  if (!isSchedule && trigger.runOn != null) {
    throw new WorkflowDefinitionError(
      `triggers[${index}].runOn is only valid on schedule or interval triggers`,
      definitionPath,
    );
  }

  if (!isSchedule && trigger.payload != null) {
    throw new WorkflowDefinitionError(
      `triggers[${index}].payload is only valid on schedule or interval triggers`,
      definitionPath,
    );
  }

  if (isSchedule && trigger.filter != null) {
    throw new WorkflowDefinitionError(
      `triggers[${index}]: schedule triggers do not support filter`,
      definitionPath,
    );
  }

  if (isSchedule && trigger.batch != null) {
    throw new WorkflowDefinitionError(
      `triggers[${index}]: schedule triggers do not support batch`,
      definitionPath,
    );
  }

  if (trigger.schedule != null && trigger.intervalMs != null) {
    throw new WorkflowDefinitionError(
      `triggers[${index}]: specify either schedule or intervalMs, not both`,
      definitionPath,
    );
  }

  if (trigger.timezone != null && trigger.schedule == null) {
    throw new WorkflowDefinitionError(
      `triggers[${index}].timezone is only valid on cron schedule triggers`,
      definitionPath,
    );
  }

  const event = isSchedule
    ? (trigger.event ?? "schedule")
    : expectNonEmptyString(trigger.event, `triggers[${index}].event`, definitionPath);
  const runOn = (() => {
    if (trigger.runOn === undefined) return undefined;
    if (
      typeof trigger.runOn !== "string" ||
      !RUN_ON_VALUES.includes(trigger.runOn as WorkflowTriggerRunOn)
    ) {
      throw new WorkflowDefinitionError(
        `triggers[${index}].runOn must be "every-scope" or "default-scope"`,
        definitionPath,
      );
    }
    return trigger.runOn as WorkflowTriggerRunOn;
  })();
  const payload = validateScheduledPayload(
    trigger.payload,
    `triggers[${index}].payload`,
    definitionPath,
  );

  const cooldownMs =
    expectOptionalInteger(
      trigger.cooldownMs,
      `triggers[${index}].cooldownMs`,
      definitionPath,
      0,
    ) ?? 0;

  const schemaVersion = expectOptionalInteger(
    trigger.schemaVersion,
    `triggers[${index}].schemaVersion`,
    definitionPath,
    1,
  );

  if (isSchedule && schemaVersion !== undefined) {
    throw new WorkflowDefinitionError(
      `triggers[${index}]: schedule triggers do not support schemaVersion`,
      definitionPath,
    );
  }

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
    let timezone: string | undefined;
    if (trigger.timezone != null) {
      if (typeof trigger.timezone !== "string" || !trigger.timezone.trim()) {
        throw new WorkflowDefinitionError(
          `triggers[${index}].timezone must be a non-empty string`,
          definitionPath,
        );
      }
      const tzError = validateTimezone(trigger.timezone);
      if (tzError) {
        throw new WorkflowDefinitionError(
          `triggers[${index}].timezone: ${tzError}`,
          definitionPath,
        );
      }
      timezone = trigger.timezone;
    }
    return {
      event,
      cooldownMs,
      schedule: trigger.schedule,
      timezone,
      ...(runOn !== undefined ? { runOn } : {}),
      ...(payload !== undefined ? { payload } : {}),
      ...(queueMode !== undefined ? { queueMode } : {}),
    };
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
    return {
      event,
      cooldownMs,
      intervalMs,
      ...(runOn !== undefined ? { runOn } : {}),
      ...(payload !== undefined ? { payload } : {}),
      ...(queueMode !== undefined ? { queueMode } : {}),
    };
  }

  const registry = getModuleEventRegistry();
  const declared = registry?.get(event);
  if (
    declared &&
    schemaVersion !== undefined &&
    schemaVersion !== declared.currentVersion
  ) {
    throw new WorkflowDefinitionError(
      `triggers[${index}] references schemaVersion ${schemaVersion} for event "${event}", ` +
        `but module "${declared.module}" currently declares schemaVersion ${declared.currentVersion}.`,
      definitionPath,
    );
  }

  const filter = expectOptionalScalarFilter(
    trigger.filter,
    `triggers[${index}].filter`,
    definitionPath,
  );

  if (filter) {
    if (declared) {
      const allowed = new Set(declared.filterablePaths);
      for (const key of Object.keys(filter)) {
        if (!isDeclaredField(key, allowed)) {
          throw new WorkflowDefinitionError(
            `triggers[${index}].filter references field "${key}" not filterable on event "${event}" ` +
              `(declared by module "${declared.module}" schemaVersion ${declared.currentVersion}). ` +
              `Filterable paths: ${declared.filterablePaths.join(", ") || "(none)"}.`,
            definitionPath,
          );
        }
      }
    }
  }

  const batch =
    trigger.batch === undefined
      ? undefined
      : validateBatchTrigger(trigger.batch, event, definitionPath, index);

  if (batch) {
    if (declared) {
      const allowed = new Set(declared.filterablePaths);
      for (const key of batch.groupBy) {
        if (!isDeclaredField(key, allowed)) {
          throw new WorkflowDefinitionError(
            `triggers[${index}].batch.groupBy references field "${key}" not filterable on event "${event}" ` +
              `(declared by module "${declared.module}" schemaVersion ${declared.currentVersion}). ` +
              `Filterable paths: ${declared.filterablePaths.join(", ") || "(none)"}.`,
            definitionPath,
          );
        }
      }
    }
  }

  return {
    event,
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    filter,
    batch,
    cooldownMs,
    ...(queueMode !== undefined ? { queueMode } : {}),
  };
}

function validateBatchTrigger(
  rawBatch: WorkflowTriggerInput["batch"],
  event: string,
  definitionPath: string,
  index: number,
): WorkflowBatchTrigger {
  if (!rawBatch || typeof rawBatch !== "object" || Array.isArray(rawBatch)) {
    throw new WorkflowDefinitionError(
      `triggers[${index}].batch must be an object`,
      definitionPath,
    );
  }

  const maxCount = expectOptionalInteger(
    rawBatch.maxCount,
    `triggers[${index}].batch.maxCount`,
    definitionPath,
    1,
  );
  const maxAgeMs = expectOptionalInteger(
    rawBatch.maxAgeMs,
    `triggers[${index}].batch.maxAgeMs`,
    definitionPath,
    1,
  );
  const idleTimeoutMs = expectOptionalInteger(
    rawBatch.idleTimeoutMs,
    `triggers[${index}].batch.idleTimeoutMs`,
    definitionPath,
    1,
  );
  if (maxCount === undefined && maxAgeMs === undefined && idleTimeoutMs === undefined) {
    throw new WorkflowDefinitionError(
      `triggers[${index}].batch must set at least one of maxCount, maxAgeMs, or idleTimeoutMs`,
      definitionPath,
    );
  }

  const maxBufferSize = expectOptionalInteger(
    rawBatch.maxBufferSize,
    `triggers[${index}].batch.maxBufferSize`,
    definitionPath,
    1,
  );
  if (maxBufferSize === undefined) {
    throw new WorkflowDefinitionError(
      `triggers[${index}].batch.maxBufferSize is required`,
      definitionPath,
    );
  }
  if (maxCount !== undefined && maxCount > maxBufferSize) {
    throw new WorkflowDefinitionError(
      `triggers[${index}].batch.maxCount must be <= batch.maxBufferSize`,
      definitionPath,
    );
  }
  if (!BATCH_OVERFLOW_POLICIES.includes(rawBatch.overflow)) {
    throw new WorkflowDefinitionError(
      `triggers[${index}].batch.overflow must be one of ${BATCH_OVERFLOW_POLICIES.join(", ")}`,
      definitionPath,
    );
  }

  const groupBy = validateBatchGroupBy(rawBatch.groupBy, definitionPath, index);
  const flushEvent =
    rawBatch.flushEvent === undefined
      ? undefined
      : expectNonEmptyString(
          rawBatch.flushEvent,
          `triggers[${index}].batch.flushEvent`,
          definitionPath,
        );
  if (flushEvent === event) {
    throw new WorkflowDefinitionError(
      `triggers[${index}].batch.flushEvent must differ from the source event`,
      definitionPath,
    );
  }

  return {
    ...(maxCount !== undefined ? { maxCount } : {}),
    ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
    ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {}),
    groupBy,
    ...(flushEvent !== undefined ? { flushEvent } : {}),
    maxBufferSize,
    overflow: rawBatch.overflow,
  };
}

function validateBatchGroupBy(
  rawGroupBy: WorkflowBatchTriggerInput["groupBy"],
  definitionPath: string,
  index: number,
): readonly string[] {
  if (rawGroupBy === undefined) return [];
  const fields = Array.isArray(rawGroupBy) ? rawGroupBy : [rawGroupBy];
  if (
    fields.length === 0 ||
    fields.some((field) => typeof field !== "string" || !field.trim())
  ) {
    throw new WorkflowDefinitionError(
      `triggers[${index}].batch.groupBy must be a non-empty string or array of non-empty strings`,
      definitionPath,
    );
  }
  return fields.map((field) => field.trim());
}

function isDeclaredField(key: string, allowed: Set<string>): boolean {
  return allowed.has(key);
}
