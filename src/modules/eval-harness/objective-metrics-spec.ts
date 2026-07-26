import { isAbsolute, normalize, sep } from "node:path";
import { z } from "zod";
import {
  type ObjectiveMetricJsonValue,
  type ObjectiveMetricSpec,
  ObjectiveMetricValidationError,
} from "./objective-metrics-types.js";

const positiveFiniteNumber = z.number().finite().positive();

const resourceProfileSchema = z
  .object({
    cpuAllocationCores: positiveFiniteNumber,
    cpuKillThresholdCores: positiveFiniteNumber,
    memoryAllocationMB: positiveFiniteNumber,
    memoryKillThresholdMB: positiveFiniteNumber,
    hostClass: z.string().min(1),
  })
  .strict();

const comparisonExecutionProfileSchema = z
  .object({
    status: z.literal("verified"),
    backendKind: z.enum(["host-subprocess", "container"]),
    verification: z.enum(["enforced", "observed"]),
    gateEligible: z.literal(true),
  })
  .strict();

const metricNameSchema = z.string().regex(
  /^[A-Za-z][A-Za-z0-9_.-]*$/,
  "must start with a letter and contain only letters, numbers, '.', '_' or '-'",
);

const jsonPointerSchema = z.string().refine(
  (value) => value === "" || value.startsWith("/"),
  "must be an empty string or an RFC6901-style pointer starting with '/'",
);

const metricArtifactPathSchema = z
  .string()
  .min(1)
  .refine((value) => {
    if (value.includes("\0") || isAbsolute(value)) return false;
    const normalized = normalize(value);
    return (
      normalized !== "." &&
      normalized !== ".." &&
      !normalized.startsWith(`..${sep}`) &&
      !isAbsolute(normalized)
    );
  }, "must be a relative path contained within the fixture working directory");

const objectiveMetricSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("json-file"),
      path: metricArtifactPathSchema,
      pointer: jsonPointerSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("text-file"),
      path: metricArtifactPathSchema,
      pattern: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("shell"),
      command: z.string().min(1),
      timeoutMs: positiveFiniteNumber.optional(),
    })
    .strict(),
]);

const objectiveMetricSpecSchema = z
  .object({
    name: metricNameSchema,
    unit: z.string().min(1),
    direction: z.enum(["lower_is_better", "higher_is_better"]),
    source: objectiveMetricSourceSchema,
    comparisonBaseline: z
      .object({
        value: z.number().finite(),
        resourceProfile: resourceProfileSchema,
        executionProfile: comparisonExecutionProfileSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parseObjectiveMetricSpec(
  raw: ObjectiveMetricJsonValue,
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
    } catch (error) {
      throw new ObjectiveMetricValidationError(
        "malformed-declaration",
        `Fixture at "${fixtureDir}" objective metric "${spec.name}" has invalid text-file pattern: ${(error as Error).message}`,
        { metricName: spec.name },
      );
    }
  }
  return spec;
}
