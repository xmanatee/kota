import { z } from "zod";
import { type AgentUsage, parseAgentUsage } from "#core/agent-harness/usage.js";
import { JsonFileError, readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata, WorkflowStepResult } from "./run-types.js";

const duration = z.number().finite().nonnegative();
const tokenUsage = z.unknown().transform((raw, context): AgentUsage => {
  try {
    return parseAgentUsage(raw, "usage");
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
    });
    return z.NEVER;
  }
});

const toolCall = z.strictObject({
  tool: z.string(),
  count: z.number().int().nonnegative(),
  totalMs: duration,
});

const trajectoryDiagnostics = z.strictObject({
  artifactPath: z.string(),
  warningCount: z.number().int().nonnegative(),
  unsupportedTrajectoryCount: z.number().int().nonnegative(),
  missingStreamingFramesCount: z.number().int().nonnegative(),
  missingFinalVerificationAfterEditCount: z.number().int().nonnegative(),
  repeatedIdenticalFailingCommandCount: z.number().int().nonnegative(),
  editAfterSuccessfulVerificationCount: z.number().int().nonnegative(),
  longPreambleWithoutTaskTouchCount: z.number().int().nonnegative(),
});

const stepType = z.enum([
  "tool",
  "agent",
  "emit",
  "restart",
  "code",
  "trigger",
  "parallel",
  "branch",
  "foreach",
  "approval",
  "await-event",
]);

const nonAgentStepType = z.enum([
  "tool",
  "emit",
  "restart",
  "code",
  "trigger",
  "parallel",
  "branch",
  "foreach",
  "approval",
  "await-event",
]);

const errorKind = z.enum([
  "idle-timeout",
  "step-timeout",
  "repair-no-progress",
  "repair-attempts-exhausted",
  "rate_limit",
  "auth",
  "provider",
  "runtime",
]);

const commonStep = {
  id: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: duration,
  activeDurationMs: duration.optional(),
  hostSuspendedMs: duration.optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  errorKind: errorKind.optional(),
  idleTimeoutMs: duration.optional(),
  continueOnFailure: z.boolean().optional(),
  toolCalls: z.array(toolCall).optional(),
  reused: z.boolean().optional(),
} as const;

const skippedStep = z.strictObject({
  ...commonStep,
  type: stepType,
  status: z.literal("skipped"),
  skipReason: z.strictObject({
    kind: z.enum([
      "when-predicate",
      "branch-arm-not-taken",
      "parent-skipped",
      "foreach-empty",
    ]),
    label: z.string().optional(),
  }),
});

const agentStep = z.strictObject({
  ...commonStep,
  type: z.literal("agent"),
  status: z.enum(["success", "failed"]),
  usage: tokenUsage,
  harness: z.string().optional(),
  model: z.string().optional(),
  trajectoryDiagnostics: trajectoryDiagnostics.optional(),
});

const nonAgentStep = z.strictObject({
  ...commonStep,
  type: nonAgentStepType,
  status: z.enum(["success", "failed"]),
});

const workflowStepResult = z.union([
  skippedStep,
  agentStep,
  nonAgentStep,
]) satisfies z.ZodType<WorkflowStepResult>;

const workflowRunMetadata = z.strictObject({
  id: z.string(),
  workflow: z.string(),
  definitionPath: z.string(),
  trigger: z.strictObject({
    event: z.string(),
    schemaRef: z.union([
      z.null(),
      z.strictObject({
        name: z.string().min(1),
        version: z.number().int().positive(),
      }),
    ]),
    eventId: z.string().optional(),
    payload: z.record(z.string(), z.unknown()),
  }),
  triggeredByRunId: z.string().optional(),
  causedBy: z.strictObject({
    runId: z.string(),
    workflow: z.string(),
  }).optional(),
  retryOf: z.string().optional(),
  resumedFromRunId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: z.enum([
    "running",
    "success",
    "failed",
    "interrupted",
    "completed-with-warnings",
  ]),
  durationMs: duration.optional(),
  activeDurationMs: duration.optional(),
  hostSuspendedMs: duration.optional(),
  usage: tokenUsage.optional(),
  runDir: z.string(),
  steps: z.array(workflowStepResult),
  warnings: z.array(z.strictObject({
    type: z.string(),
    message: z.string(),
  })).optional(),
}) satisfies z.ZodType<WorkflowRunMetadata>;

/** Decode untrusted persisted data into a fresh workflow-run metadata value. */
export function parseWorkflowRunMetadata(
  raw: unknown,
  field = "workflow run metadata",
): WorkflowRunMetadata {
  const parsed = workflowRunMetadata.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue?.path.length ? `.${issue.path.join(".")}` : "";
  throw new Error(`${field}${path} ${issue?.message ?? "is invalid"}`);
}

/** Read and decode one optional metadata artifact. */
export function readWorkflowRunMetadataFile(path: string): WorkflowRunMetadata | null {
  const raw = readOptionalJsonFile<unknown>(path);
  if (raw === null) return null;
  try {
    return parseWorkflowRunMetadata(raw);
  } catch (error) {
    throw new JsonFileError(
      path,
      "parse",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Best-effort read for collection views; direct run lookup remains strict. */
export function readWorkflowRunMetadataForEnumeration(
  path: string,
): WorkflowRunMetadata | null {
  try {
    return readWorkflowRunMetadataFile(path);
  } catch {
    return null;
  }
}
