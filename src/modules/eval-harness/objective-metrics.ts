import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type {
  ExecutionBackendKind,
  ExecutionProfileNonGatingReason,
  ExecutionProfilePreflightResult,
  ExecutionProfileRejectionReason,
  ExecutionProfileVerification,
  ResourceProfile,
} from "./fixture-run.js";
import {
  resourceProfileFromExecutionProfile,
  resourceProfilesComparable,
} from "./fixture-run.js";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ObjectiveMetricDirection =
  | "lower_is_better"
  | "higher_is_better";

export type ObjectiveMetricSource =
  | { kind: "json-file"; path: string; pointer: string }
  | { kind: "text-file"; path: string; pattern?: string }
  | { kind: "shell"; command: string; timeoutMs?: number };

export type ObjectiveMetricExecutionProfileSummary = {
  status: ExecutionProfilePreflightResult["status"];
  backendKind: ExecutionBackendKind;
  verification: ExecutionProfileVerification;
  gateEligible: boolean;
  reason?:
    | "verified-profile"
    | ExecutionProfileNonGatingReason
    | ExecutionProfileRejectionReason;
};

export type ObjectiveMetricComparisonBaseline = {
  value: number;
  resourceProfile: ResourceProfile;
  executionProfile: {
    status: "verified";
    backendKind: Exclude<ExecutionBackendKind, "missing-isolation-backend">;
    verification: Exclude<ExecutionProfileVerification, "unverified">;
    gateEligible: true;
  };
};

export type ObjectiveMetricSpec = {
  name: string;
  unit: string;
  direction: ObjectiveMetricDirection;
  source: ObjectiveMetricSource;
  comparisonBaseline?: ObjectiveMetricComparisonBaseline;
};

export type ObjectiveMetricComparison =
  | {
      status: "compared";
      baselineValue: number;
      currentValue: number;
      delta: number;
      improved: boolean;
      direction: ObjectiveMetricDirection;
      baselineResourceProfile: ResourceProfile;
      currentResourceProfile: ResourceProfile;
      baselineExecutionProfile: ObjectiveMetricComparisonBaseline["executionProfile"];
      currentExecutionProfile: ObjectiveMetricExecutionProfileSummary;
    }
  | {
      status: "not-compared";
      reason:
        | "resource-profile-incomparable"
        | "execution-profile-incomparable";
      baselineValue: number;
      currentValue: number;
      direction: ObjectiveMetricDirection;
      baselineResourceProfile: ResourceProfile;
      currentResourceProfile: ResourceProfile;
      baselineExecutionProfile: ObjectiveMetricComparisonBaseline["executionProfile"];
      currentExecutionProfile: ObjectiveMetricExecutionProfileSummary;
    };

export type ObservedObjectiveMetric = {
  fixtureId: string;
  name: string;
  unit: string;
  direction: ObjectiveMetricDirection;
  source: ObjectiveMetricSource;
  value: number;
  runIndex: number;
  repeatCount: number;
  resourceProfile: ResourceProfile;
  executionProfile: ObjectiveMetricExecutionProfileSummary;
  comparisonBaseline?: ObjectiveMetricComparisonBaseline;
  comparison?: ObjectiveMetricComparison;
};

export type ObjectiveMetricResourceComparison =
  | { status: "comparable"; resourceProfile: ResourceProfile }
  | {
      status: "not-comparable";
      reason: "mixed-resource-profiles";
      resourceProfiles: ResourceProfile[];
    };

export type ObjectiveMetricExecutionComparison =
  | {
      status: "comparable";
      executionProfile: ObjectiveMetricExecutionProfileSummary;
    }
  | {
      status: "not-comparable";
      reason: "mixed-execution-profiles" | "non-gating-execution-profile";
      executionProfiles: ObjectiveMetricExecutionProfileSummary[];
    };

export type AggregateObjectiveMetric = {
  fixtureId: string;
  name: string;
  unit: string;
  direction: ObjectiveMetricDirection;
  sampleCount: number;
  values: number[];
  min: number;
  max: number;
  mean: number;
  resourceProfileComparison: ObjectiveMetricResourceComparison;
  executionProfileComparison: ObjectiveMetricExecutionComparison;
  comparisonBaseline?: ObjectiveMetricComparisonBaseline;
  comparison?: ObjectiveMetricComparison;
};

export type ObjectiveMetricValidationReason =
  | "malformed-declaration"
  | "missing-source"
  | "nonnumeric-value"
  | "source-failed"
  | "environment-incomparable";

export class ObjectiveMetricValidationError extends Error {
  readonly reason: ObjectiveMetricValidationReason;
  readonly fixtureId: string | null;
  readonly metricName: string | null;

  constructor(
    reason: ObjectiveMetricValidationReason,
    message: string,
    options: { fixtureId?: string; metricName?: string } = {},
  ) {
    super(message);
    this.name = "ObjectiveMetricValidationError";
    this.reason = reason;
    this.fixtureId = options.fixtureId ?? null;
    this.metricName = options.metricName ?? null;
  }
}

const positiveFiniteNumber = z.number().finite().positive();

const resourceProfileSchema = z.object({
  cpuAllocationCores: positiveFiniteNumber,
  cpuKillThresholdCores: positiveFiniteNumber,
  memoryAllocationMB: positiveFiniteNumber,
  memoryKillThresholdMB: positiveFiniteNumber,
  hostClass: z.string().min(1),
}).strict();

const comparisonExecutionProfileSchema = z.object({
  status: z.literal("verified"),
  backendKind: z.enum(["host-subprocess", "container"]),
  verification: z.enum(["enforced", "observed"]),
  gateEligible: z.literal(true),
}).strict();

const metricNameSchema = z.string().regex(
  /^[A-Za-z][A-Za-z0-9_.-]*$/,
  "must start with a letter and contain only letters, numbers, '.', '_' or '-'",
);

const jsonPointerSchema = z.string().refine(
  (value) => value === "" || value.startsWith("/"),
  "must be an empty string or an RFC6901-style pointer starting with '/'",
);

const objectiveMetricSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("json-file"),
    path: z.string().min(1),
    pointer: jsonPointerSchema,
  }).strict(),
  z.object({
    kind: z.literal("text-file"),
    path: z.string().min(1),
    pattern: z.string().min(1).optional(),
  }).strict(),
  z.object({
    kind: z.literal("shell"),
    command: z.string().min(1),
    timeoutMs: positiveFiniteNumber.optional(),
  }).strict(),
]);

const objectiveMetricSpecSchema = z.object({
  name: metricNameSchema,
  unit: z.string().min(1),
  direction: z.enum(["lower_is_better", "higher_is_better"]),
  source: objectiveMetricSourceSchema,
  comparisonBaseline: z.object({
    value: z.number().finite(),
    resourceProfile: resourceProfileSchema,
    executionProfile: comparisonExecutionProfileSchema,
  }).strict().optional(),
}).strict();

const DEFAULT_METRIC_SHELL_TIMEOUT_MS = 60_000;
const MAX_METRIC_SHELL_TIMEOUT_MS = 5 * 60 * 1000;

function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parseObjectiveMetricSpec(
  raw: JsonValue,
  fixtureDir: string,
): ObjectiveMetricSpec {
  const parsed = objectiveMetricSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const environmentIssue = parsed.error.issues.some(
      (issue) => issue.path[0] === "comparisonBaseline",
    );
    throw new ObjectiveMetricValidationError(
      environmentIssue ? "environment-incomparable" : "malformed-declaration",
      `Fixture at "${fixtureDir}" has invalid objective metric declaration: ${describeZodError(parsed.error)}`,
    );
  }
  const spec = parsed.data;
  if (spec.source.kind === "text-file" && spec.source.pattern !== undefined) {
    try {
      new RegExp(spec.source.pattern);
    } catch (err) {
      throw new ObjectiveMetricValidationError(
        "malformed-declaration",
        `Fixture at "${fixtureDir}" objective metric "${spec.name}" has invalid text-file pattern: ${(err as Error).message}`,
        { metricName: spec.name },
      );
    }
  }
  return spec;
}

function resolveShellTimeout(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_METRIC_SHELL_TIMEOUT_MS;
  return Math.min(requested, MAX_METRIC_SHELL_TIMEOUT_MS);
}

function parseNumericText(
  raw: string,
  fixtureId: string,
  metricName: string,
  sourceDescription: string,
): number {
  const text = raw.trim();
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/i.test(text)) {
    throw new ObjectiveMetricValidationError(
      "nonnumeric-value",
      `Objective metric "${metricName}" for fixture "${fixtureId}" produced nonnumeric value from ${sourceDescription}: ${JSON.stringify(text)}.`,
      { fixtureId, metricName },
    );
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new ObjectiveMetricValidationError(
      "nonnumeric-value",
      `Objective metric "${metricName}" for fixture "${fixtureId}" produced nonfinite value from ${sourceDescription}: ${JSON.stringify(text)}.`,
      { fixtureId, metricName },
    );
  }
  return value;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function valueAtJsonPointer(document: JsonValue, pointer: string): JsonValue | undefined {
  if (pointer === "") return document;
  let current: JsonValue | undefined = document;
  for (const rawSegment of pointer.slice(1).split("/")) {
    if (current === undefined) return undefined;
    const segment = decodeJsonPointerSegment(rawSegment);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (current !== null && typeof current === "object") {
      current = Object.hasOwn(current, segment) ? current[segment] : undefined;
      continue;
    }
    return undefined;
  }
  return current;
}

function extractJsonFileMetric(
  workingDir: string,
  fixtureId: string,
  metricName: string,
  source: Extract<ObjectiveMetricSource, { kind: "json-file" }>,
): number {
  const filePath = join(workingDir, source.path);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new ObjectiveMetricValidationError(
      "missing-source",
      `Objective metric "${metricName}" for fixture "${fixtureId}" missing json-file source ${source.path}.`,
      { fixtureId, metricName },
    );
  }
  let document: JsonValue;
  try {
    document = JSON.parse(readFileSync(filePath, "utf-8")) as JsonValue;
  } catch (err) {
    throw new ObjectiveMetricValidationError(
      "source-failed",
      `Objective metric "${metricName}" for fixture "${fixtureId}" could not parse ${source.path} as JSON: ${(err as Error).message}`,
      { fixtureId, metricName },
    );
  }
  const value = valueAtJsonPointer(document, source.pointer);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ObjectiveMetricValidationError(
      value === undefined ? "missing-source" : "nonnumeric-value",
      `Objective metric "${metricName}" for fixture "${fixtureId}" expected finite numeric JSON value at ${source.path}${source.pointer}; got ${JSON.stringify(value)}.`,
      { fixtureId, metricName },
    );
  }
  return value;
}

function extractTextFileMetric(
  workingDir: string,
  fixtureId: string,
  metricName: string,
  source: Extract<ObjectiveMetricSource, { kind: "text-file" }>,
): number {
  const filePath = join(workingDir, source.path);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new ObjectiveMetricValidationError(
      "missing-source",
      `Objective metric "${metricName}" for fixture "${fixtureId}" missing text-file source ${source.path}.`,
      { fixtureId, metricName },
    );
  }
  const content = readFileSync(filePath, "utf-8");
  if (source.pattern === undefined) {
    return parseNumericText(content, fixtureId, metricName, source.path);
  }
  const match = new RegExp(source.pattern, "m").exec(content);
  if (match === null) {
    throw new ObjectiveMetricValidationError(
      "missing-source",
      `Objective metric "${metricName}" for fixture "${fixtureId}" pattern did not match ${source.path}: ${source.pattern}.`,
      { fixtureId, metricName },
    );
  }
  return parseNumericText(
    match[1] ?? match[0],
    fixtureId,
    metricName,
    `${source.path} pattern ${source.pattern}`,
  );
}

function extractShellMetric(
  workingDir: string,
  fixtureId: string,
  metricName: string,
  source: Extract<ObjectiveMetricSource, { kind: "shell" }>,
): number {
  const timeoutMs = resolveShellTimeout(source.timeoutMs);
  const result = spawnSync(source.command, {
    shell: true,
    cwd: workingDir,
    env: withProtectedGitBareRepositoryEnv(),
    timeout: timeoutMs,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const timedOut =
    result.signal === "SIGTERM" || result.error?.message.includes("ETIMEDOUT");
  if (timedOut || result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new ObjectiveMetricValidationError(
      "source-failed",
      `Objective metric "${metricName}" for fixture "${fixtureId}" shell source failed (${timedOut ? `timeout after ${timeoutMs}ms` : `exit ${result.status}`}): ${source.command}${detail ? `\n${detail}` : ""}`,
      { fixtureId, metricName },
    );
  }
  return parseNumericText(
    result.stdout,
    fixtureId,
    metricName,
    `shell command ${JSON.stringify(source.command)}`,
  );
}

function extractMetricValue(
  workingDir: string,
  fixtureId: string,
  spec: ObjectiveMetricSpec,
): number {
  switch (spec.source.kind) {
    case "json-file":
      return extractJsonFileMetric(workingDir, fixtureId, spec.name, spec.source);
    case "text-file":
      return extractTextFileMetric(workingDir, fixtureId, spec.name, spec.source);
    case "shell":
      return extractShellMetric(workingDir, fixtureId, spec.name, spec.source);
  }
}

function summarizeExecutionProfile(
  profile: ExecutionProfilePreflightResult,
): ObjectiveMetricExecutionProfileSummary {
  if (profile.status === "verified") {
    return {
      status: profile.status,
      backendKind: profile.backendKind,
      verification: profile.verification,
      gateEligible: profile.gateEligible,
      reason: profile.eligibilityReason,
    };
  }
  if (profile.status === "rejected") {
    return {
      status: profile.status,
      backendKind: profile.backendKind,
      verification: profile.verification,
      gateEligible: profile.gateEligible,
      reason: profile.rejectionReason,
    };
  }
  return {
    status: profile.status,
    backendKind: profile.backendKind,
    verification: profile.verification,
    gateEligible: profile.gateEligible,
    reason: profile.nonGatingReason,
  };
}

function executionProfilesComparable(
  baseline: ObjectiveMetricComparisonBaseline["executionProfile"],
  current: ObjectiveMetricExecutionProfileSummary,
): boolean {
  return (
    current.gateEligible &&
    current.status === baseline.status &&
    current.backendKind === baseline.backendKind &&
    current.verification === baseline.verification
  );
}

function compareToBaseline(params: {
  value: number;
  direction: ObjectiveMetricDirection;
  baseline: ObjectiveMetricComparisonBaseline;
  currentResourceProfile: ResourceProfile;
  currentExecutionProfile: ObjectiveMetricExecutionProfileSummary;
}): ObjectiveMetricComparison {
  const common = {
    baselineValue: params.baseline.value,
    currentValue: params.value,
    direction: params.direction,
    baselineResourceProfile: params.baseline.resourceProfile,
    currentResourceProfile: params.currentResourceProfile,
    baselineExecutionProfile: params.baseline.executionProfile,
    currentExecutionProfile: params.currentExecutionProfile,
  };
  if (
    !resourceProfilesComparable(
      params.baseline.resourceProfile,
      params.currentResourceProfile,
    )
  ) {
    return {
      status: "not-compared",
      reason: "resource-profile-incomparable",
      ...common,
    };
  }
  if (
    !executionProfilesComparable(
      params.baseline.executionProfile,
      params.currentExecutionProfile,
    )
  ) {
    return {
      status: "not-compared",
      reason: "execution-profile-incomparable",
      ...common,
    };
  }
  const delta = params.value - params.baseline.value;
  const improved =
    params.direction === "lower_is_better"
      ? params.value < params.baseline.value
      : params.value > params.baseline.value;
  return {
    status: "compared",
    delta,
    improved,
    ...common,
  };
}

export function evaluateObjectiveMetrics(params: {
  fixtureId: string;
  metricSpecs: readonly ObjectiveMetricSpec[];
  workingDir: string;
  executionProfile: ExecutionProfilePreflightResult;
  runIndex: number;
  repeatCount: number;
}): ObservedObjectiveMetric[] {
  const resourceProfile = resourceProfileFromExecutionProfile(
    params.executionProfile,
  );
  const executionProfile = summarizeExecutionProfile(params.executionProfile);
  return params.metricSpecs.map((spec) => {
    const value = extractMetricValue(params.workingDir, params.fixtureId, spec);
    const comparison =
      spec.comparisonBaseline === undefined
        ? undefined
        : compareToBaseline({
            value,
            direction: spec.direction,
            baseline: spec.comparisonBaseline,
            currentResourceProfile: resourceProfile,
            currentExecutionProfile: executionProfile,
          });
    return {
      fixtureId: params.fixtureId,
      name: spec.name,
      unit: spec.unit,
      direction: spec.direction,
      source: spec.source,
      value,
      runIndex: params.runIndex,
      repeatCount: params.repeatCount,
      resourceProfile,
      executionProfile,
      ...(spec.comparisonBaseline !== undefined && {
        comparisonBaseline: spec.comparisonBaseline,
      }),
      ...(comparison !== undefined && { comparison }),
    };
  });
}

function uniqueByJson<T>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function resourceComparison(
  metrics: readonly ObservedObjectiveMetric[],
): ObjectiveMetricResourceComparison {
  const first = metrics[0].resourceProfile;
  if (metrics.every((metric) => resourceProfilesComparable(first, metric.resourceProfile))) {
    return { status: "comparable", resourceProfile: first };
  }
  return {
    status: "not-comparable",
    reason: "mixed-resource-profiles",
    resourceProfiles: uniqueByJson(metrics.map((metric) => metric.resourceProfile)),
  };
}

function executionComparison(
  metrics: readonly ObservedObjectiveMetric[],
): ObjectiveMetricExecutionComparison {
  const profiles = metrics.map((metric) => metric.executionProfile);
  if (profiles.some((profile) => !profile.gateEligible)) {
    return {
      status: "not-comparable",
      reason: "non-gating-execution-profile",
      executionProfiles: uniqueByJson(profiles),
    };
  }
  const first = profiles[0];
  if (
    profiles.every(
      (profile) =>
        profile.status === first.status &&
        profile.backendKind === first.backendKind &&
        profile.verification === first.verification &&
        profile.gateEligible === first.gateEligible,
    )
  ) {
    return { status: "comparable", executionProfile: first };
  }
  return {
    status: "not-comparable",
    reason: "mixed-execution-profiles",
    executionProfiles: uniqueByJson(profiles),
  };
}

function assertMetricIdentityStable(
  fixtureId: string,
  name: string,
  metrics: readonly ObservedObjectiveMetric[],
): void {
  const first = metrics[0];
  for (const metric of metrics) {
    if (metric.unit !== first.unit || metric.direction !== first.direction) {
      throw new ObjectiveMetricValidationError(
        "malformed-declaration",
        `Objective metric "${name}" for fixture "${fixtureId}" has inconsistent unit or direction across runs.`,
        { fixtureId, metricName: name },
      );
    }
    if (
      JSON.stringify(metric.comparisonBaseline ?? null) !==
      JSON.stringify(first.comparisonBaseline ?? null)
    ) {
      throw new ObjectiveMetricValidationError(
        "environment-incomparable",
        `Objective metric "${name}" for fixture "${fixtureId}" has inconsistent comparison baselines across runs.`,
        { fixtureId, metricName: name },
      );
    }
  }
}

export function aggregateObjectiveMetrics(
  runs: readonly { objectiveMetrics: readonly ObservedObjectiveMetric[] }[],
): AggregateObjectiveMetric[] {
  const grouped = new Map<string, ObservedObjectiveMetric[]>();
  for (const run of runs) {
    for (const metric of run.objectiveMetrics) {
      const key = `${metric.fixtureId}\u0000${metric.name}`;
      const bucket = grouped.get(key);
      if (bucket) bucket.push(metric);
      else grouped.set(key, [metric]);
    }
  }

  const aggregates: AggregateObjectiveMetric[] = [];
  for (const bucket of grouped.values()) {
    const first = bucket[0];
    assertMetricIdentityStable(first.fixtureId, first.name, bucket);
    const values = bucket.map((metric) => metric.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const profileComparison = resourceComparison(bucket);
    const profileExecutionComparison = executionComparison(bucket);
    let comparison: ObjectiveMetricComparison | undefined;
    if (first.comparisonBaseline !== undefined) {
      if (profileComparison.status !== "comparable") {
        comparison = {
          status: "not-compared",
          reason: "resource-profile-incomparable",
          baselineValue: first.comparisonBaseline.value,
          currentValue: mean,
          direction: first.direction,
          baselineResourceProfile: first.comparisonBaseline.resourceProfile,
          currentResourceProfile: bucket[0].resourceProfile,
          baselineExecutionProfile: first.comparisonBaseline.executionProfile,
          currentExecutionProfile: bucket[0].executionProfile,
        };
      } else if (profileExecutionComparison.status !== "comparable") {
        comparison = {
          status: "not-compared",
          reason: "execution-profile-incomparable",
          baselineValue: first.comparisonBaseline.value,
          currentValue: mean,
          direction: first.direction,
          baselineResourceProfile: first.comparisonBaseline.resourceProfile,
          currentResourceProfile: profileComparison.resourceProfile,
          baselineExecutionProfile: first.comparisonBaseline.executionProfile,
          currentExecutionProfile: bucket[0].executionProfile,
        };
      } else {
        comparison = compareToBaseline({
          value: mean,
          direction: first.direction,
          baseline: first.comparisonBaseline,
          currentResourceProfile: profileComparison.resourceProfile,
          currentExecutionProfile: profileExecutionComparison.executionProfile,
        });
      }
    }
    aggregates.push({
      fixtureId: first.fixtureId,
      name: first.name,
      unit: first.unit,
      direction: first.direction,
      sampleCount: values.length,
      values,
      min,
      max,
      mean,
      resourceProfileComparison: profileComparison,
      executionProfileComparison: profileExecutionComparison,
      ...(first.comparisonBaseline !== undefined && {
        comparisonBaseline: first.comparisonBaseline,
      }),
      ...(comparison !== undefined && { comparison }),
    });
  }
  return aggregates.sort((a, b) =>
    `${a.fixtureId}.${a.name}`.localeCompare(`${b.fixtureId}.${b.name}`),
  );
}
