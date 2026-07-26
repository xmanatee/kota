import { readObjectiveMetricArtifact } from "./objective-metric-artifact-reader.js";
import {
  type ObjectiveMetricJsonValue,
  type ObjectiveMetricSource,
  type ObjectiveMetricSpec,
  ObjectiveMetricValidationError,
} from "./objective-metrics-types.js";
import type { PredicateEvaluationContext } from "./predicates.js";

const DEFAULT_METRIC_SHELL_TIMEOUT_MS = 60_000;
const MAX_METRIC_SHELL_TIMEOUT_MS = 5 * 60 * 1000;

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
      `Objective metric "${metricName}" for fixture "${fixtureId}" produced a nonnumeric value from ${sourceDescription}.`,
      { fixtureId, metricName },
    );
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new ObjectiveMetricValidationError(
      "nonnumeric-value",
      `Objective metric "${metricName}" for fixture "${fixtureId}" produced a nonfinite value from ${sourceDescription}.`,
      { fixtureId, metricName },
    );
  }
  return value;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function valueAtJsonPointer(
  document: ObjectiveMetricJsonValue,
  pointer: string,
): ObjectiveMetricJsonValue | undefined {
  if (pointer === "") return document;
  let current: ObjectiveMetricJsonValue | undefined = document;
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
  const content = readObjectiveMetricArtifact({
    workingDir,
    fixtureId,
    metricName,
    relativePath: source.path,
  });
  let document: ObjectiveMetricJsonValue;
  try {
    document = JSON.parse(content) as ObjectiveMetricJsonValue;
  } catch {
    throw new ObjectiveMetricValidationError(
      "source-failed",
      `Objective metric "${metricName}" for fixture "${fixtureId}" could not parse ${source.path} as JSON.`,
      { fixtureId, metricName },
    );
  }
  const value = valueAtJsonPointer(document, source.pointer);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ObjectiveMetricValidationError(
      value === undefined ? "missing-source" : "nonnumeric-value",
      `Objective metric "${metricName}" for fixture "${fixtureId}" expected a finite numeric JSON value at ${source.path}${source.pointer}.`,
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
  const content = readObjectiveMetricArtifact({
    workingDir,
    fixtureId,
    metricName,
    relativePath: source.path,
  });
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

async function extractShellMetric(
  workingDir: string,
  fixtureId: string,
  metricName: string,
  source: Extract<ObjectiveMetricSource, { kind: "shell" }>,
  scoringContext: PredicateEvaluationContext | undefined,
): Promise<number> {
  const timeoutMs = resolveShellTimeout(source.timeoutMs);
  const verifier = scoringContext?.executableVerifier;
  if (verifier === undefined) {
    throw new ObjectiveMetricValidationError(
      "source-failed",
      `Objective metric "${metricName}" for fixture "${fixtureId}" requires a verified isolated verifier; refusing evaluator-host shell execution.`,
      { fixtureId, metricName },
    );
  }
  const execution = await verifier({
    workingDir,
    command: source.command,
    timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (!execution.started) {
    throw new ObjectiveMetricValidationError(
      "source-failed",
      `Objective metric "${metricName}" for fixture "${fixtureId}" verified isolated verifier unavailable: ${execution.issue}`,
      { fixtureId, metricName },
    );
  }
  const { result } = execution;
  const timedOut = result.error?.name === "ETIMEDOUT";
  if (result.error !== undefined || result.status !== 0) {
    const detail = [result.stdout, result.stderr, result.error?.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new ObjectiveMetricValidationError(
      "source-failed",
      `Objective metric "${metricName}" for fixture "${fixtureId}" shell source failed inside ${execution.isolation.evidence} (${timedOut ? `timeout after ${timeoutMs}ms` : `exit ${result.status}`}): ${source.command}${detail ? `\n${detail}` : ""}`,
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

export async function extractObjectiveMetricValue(
  workingDir: string,
  fixtureId: string,
  spec: ObjectiveMetricSpec,
  scoringContext: PredicateEvaluationContext | undefined,
): Promise<number> {
  switch (spec.source.kind) {
    case "json-file":
      return extractJsonFileMetric(workingDir, fixtureId, spec.name, spec.source);
    case "text-file":
      return extractTextFileMetric(workingDir, fixtureId, spec.name, spec.source);
    case "shell":
      return extractShellMetric(
        workingDir,
        fixtureId,
        spec.name,
        spec.source,
        scoringContext,
      );
  }
}
