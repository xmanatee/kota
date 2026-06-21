
import { isAbsolute, win32 } from "node:path";
import type { FixtureJsonObject, FixtureJsonValue } from "./fixture-common-types.js";
import { type ObjectiveMetricSpec, ObjectiveMetricValidationError, parseObjectiveMetricSpec } from "./objective-metrics.js";

const MAX_BUDGET_MS = 60 * 60 * 1000;
const MIN_BUDGET_MS = 30_000;

export function isStringArray(
  value: FixtureJsonValue | undefined,
): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function isSafeRelativeAuditPath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.startsWith("\\")) {
    return false;
  }
  return !path.split(/[\\/]+/).some((segment) => segment === "..");
}

export function isSafeRelativeFixturePath(path: string): boolean {
  return isSafeRelativeAuditPath(path);
}

export function isJsonObject(
  value: FixtureJsonValue | undefined,
): value is FixtureJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRequiredString(
  r: FixtureJsonObject,
  key: string,
  fixtureDir: string,
): string {
  const value = r[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" is missing required string field "${key}".`,
    );
  }
  return value;
}

const SAFE_SKILL_ABLATION_VARIANT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function parseSkillAblationVariantId(
  raw: FixtureJsonObject,
  fixtureDir: string,
  index: number,
): string {
  const id = parseRequiredString(raw, "id", fixtureDir);
  if (
    !SAFE_SKILL_ABLATION_VARIANT_ID.test(id) ||
    id === "." ||
    id === ".." ||
    id.includes("/") ||
    id.includes("\\") ||
    isAbsolute(id) ||
    win32.isAbsolute(id)
  ) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variants[${index}].id must be a safe single path component matching ${SAFE_SKILL_ABLATION_VARIANT_ID}: ${JSON.stringify(id)}.`,
    );
  }
  return id;
}

export function parseBudgetMs(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  label = "budgetMs",
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" must set a numeric ${label}; got ${String(raw)}.`,
    );
  }
  if (raw < MIN_BUDGET_MS || raw > MAX_BUDGET_MS) {
    throw new Error(
      `Fixture at "${fixtureDir}" ${label}=${raw} outside [${MIN_BUDGET_MS}, ${MAX_BUDGET_MS}].`,
    );
  }
  return raw;
}

export function parseOptionalTags(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
): string[] | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw) && raw.every((t) => typeof t === "string")) {
    return raw;
  }
  throw new Error(
    `Fixture at "${fixtureDir}" has invalid tags; must be an array of strings.`,
  );
}

export function parseJsonPayload(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  label: string,
): FixtureJsonObject | undefined {
  if (raw === undefined) return undefined;
  if (isJsonObject(raw)) return raw;
  throw new Error(
    `Fixture at "${fixtureDir}" has invalid ${label}; must be a JSON object.`,
  );
}

export function parseExternalCallShims(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!isStringArray(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" has invalid externalCallShims; must be an array of binary-name strings.`,
    );
  }
  for (const name of raw) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error(
        `Fixture at "${fixtureDir}" externalCallShims entry ${JSON.stringify(name)} contains characters outside [A-Za-z0-9._-]. Refuse to install a shim with that name.`,
      );
    }
  }
  return raw;
}

export function parseObjectiveMetrics(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  label: string,
): ObjectiveMetricSpec[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ObjectiveMetricValidationError(
      "malformed-declaration",
      `Fixture at "${fixtureDir}" has invalid ${label}; must be a non-empty array when present.`,
    );
  }
  const objectiveMetrics: ObjectiveMetricSpec[] = [];
  const names = new Set<string>();
  for (const metric of raw) {
    const parsedMetric = parseObjectiveMetricSpec(metric, fixtureDir);
    if (names.has(parsedMetric.name)) {
      throw new ObjectiveMetricValidationError(
        "malformed-declaration",
        `Fixture at "${fixtureDir}" declares duplicate objective metric name "${parsedMetric.name}" in ${label}.`,
        { metricName: parsedMetric.name },
      );
    }
    names.add(parsedMetric.name);
    objectiveMetrics.push(parsedMetric);
  }
  return objectiveMetrics;
}

export function assertNoModeFields(
  r: FixtureJsonObject,
  fixtureDir: string,
  mode: string,
  fields: readonly string[],
): void {
  const present = fields.filter((field) => r[field] !== undefined);
  if (present.length === 0) return;
  throw new Error(
    `Fixture at "${fixtureDir}" mode "${mode}" cannot declare ${present.join(", ")}.`,
  );
}
