import type { HealthCheckResult, ModuleHealth } from "./module-types.js";

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertKnownFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new Error(`${label} has unknown field "${key}"`);
  }
}

/** Decode the result of a module's optional runtime health check. */
export function decodeHealthCheckResult(value: unknown, label: string): HealthCheckResult {
  assertRecord(value, label);
  assertKnownFields(value, new Set(["status", "message"]), label);
  if (value.status !== "healthy" && value.status !== "degraded" && value.status !== "unhealthy") {
    throw new Error(`${label}.status is invalid`);
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    throw new Error(`${label}.message must be a string when present`);
  }
  return {
    status: value.status,
    ...(value.message !== undefined && { message: value.message }),
  };
}

/** Decode a module's host-lifecycle health projection before publishing it. */
export function decodeModuleHealth(value: unknown, label: string): ModuleHealth {
  assertRecord(value, label);
  assertKnownFields(value, new Set(["status", "restartCount", "lastRestartAt"]), label);
  if (value.status !== "ok" && value.status !== "restarting" && value.status !== "dead") {
    throw new Error(`${label}.status is invalid`);
  }
  if (
    typeof value.restartCount !== "number" ||
    !Number.isSafeInteger(value.restartCount) ||
    value.restartCount < 0
  ) {
    throw new Error(`${label}.restartCount must be a non-negative safe integer`);
  }
  if (value.lastRestartAt !== undefined && typeof value.lastRestartAt !== "string") {
    throw new Error(`${label}.lastRestartAt must be a string when present`);
  }
  return {
    status: value.status,
    restartCount: value.restartCount,
    ...(value.lastRestartAt !== undefined && { lastRestartAt: value.lastRestartAt }),
  };
}
