import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EventBus } from "#core/events/event-bus.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import { buildStepCompletedPayload } from "./event-payloads.js";
import type { ToolCallSummaryEntry, WorkflowRunMetadata, WorkflowRunWarning, WorkflowStepContext, WorkflowStepResult } from "./run-types.js";
import {
  type AgentStepConfig,
  AgentStepRuntimeError,
  executeStep,
} from "./step-executor.js";
import type {
  WorkflowAgentBackoffSignal,
  WorkflowDefinition,
  WorkflowRunTrigger,
  WorkflowStep,
} from "./types.js";

/** Default step timeout when no timeoutMs is specified on the step definition. */
export const DEFAULT_STEP_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const DEFAULT_MAX_STEP_OUTPUT_BYTES = 256 * 1024; // 256 KB
export const HARD_MAX_STEP_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB

export type TruncationNotice = {
  truncated: true;
  originalBytes: number;
  message: string;
};

export function applyOutputSizeLimit(
  output: unknown,
  maxBytes: number | undefined,
): { output: unknown; warning?: WorkflowRunWarning } {
  if (output === undefined || output === null) return { output };
  const limit = Math.min(maxBytes ?? DEFAULT_MAX_STEP_OUTPUT_BYTES, HARD_MAX_STEP_OUTPUT_BYTES);
  let serialized: string;
  try {
    serialized = JSON.stringify(output);
  } catch {
    return { output };
  }
  const byteLength = Buffer.byteLength(serialized, "utf-8");
  if (byteLength <= limit) return { output };
  const notice: TruncationNotice = {
    truncated: true,
    originalBytes: byteLength,
    message: `Step output truncated: ${byteLength} bytes exceeds ${limit}-byte limit`,
  };
  return {
    output: notice,
    warning: { type: "step-output-truncated", message: notice.message },
  };
}

export type StepAccumulators = {
  stepOutputsById: Record<string, unknown>;
  stepResultsById: Record<string, WorkflowStepResult>;
  stepOutputs: unknown[];
  warnings: WorkflowRunWarning[];
};

type StepDeps = {
  bus: EventBus;
  log: (message: string) => void;
};

export function buildSkippedResult(
  step: WorkflowStep,
  stepStartedAt: number,
  acc: StepAccumulators,
  recordStep: (result: WorkflowStepResult) => void,
  bus: EventBus,
  runMetadata: WorkflowRunMetadata,
): WorkflowStepResult {
  const skipped: WorkflowStepResult = {
    id: step.id,
    type: step.type,
    status: "skipped",
    startedAt: new Date(stepStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - stepStartedAt,
  };
  recordStep(skipped);
  acc.stepOutputsById[step.id] = { skipped: true };
  acc.stepResultsById[step.id] = skipped;
  acc.stepOutputs.push({ skipped: true });
  if (step.type === "parallel") {
    const skippedAt = new Date(stepStartedAt).toISOString();
    for (const childStep of step.steps) {
      const childSkipped: WorkflowStepResult = {
        id: childStep.id,
        type: childStep.type,
        status: "skipped",
        startedAt: skippedAt,
        completedAt: skippedAt,
        durationMs: 0,
      };
      acc.stepOutputsById[childStep.id] = { skipped: true };
      acc.stepResultsById[childStep.id] = childSkipped;
    }
  } else if (step.type === "branch") {
    const skippedAt = new Date(stepStartedAt).toISOString();
    const skipArmSteps = (armSteps: typeof step.ifTrue) => {
      for (const armStep of armSteps) {
        acc.stepOutputsById[armStep.id] = { skipped: true };
        acc.stepResultsById[armStep.id] = {
          id: armStep.id,
          type: armStep.type,
          status: "skipped",
          startedAt: skippedAt,
          completedAt: skippedAt,
          durationMs: 0,
        };
        if (armStep.type === "branch") {
          skipArmSteps(armStep.ifTrue);
          skipArmSteps(armStep.ifFalse);
        }
      }
    };
    skipArmSteps(step.ifTrue);
    skipArmSteps(step.ifFalse);
  } else if (step.type === "foreach") {
    const skippedAt = new Date(stepStartedAt).toISOString();
    for (const innerStep of step.steps) {
      acc.stepOutputsById[innerStep.id] = { skipped: true };
      acc.stepResultsById[innerStep.id] = {
        id: innerStep.id,
        type: innerStep.type,
        status: "skipped",
        startedAt: skippedAt,
        completedAt: skippedAt,
        durationMs: 0,
      };
    }
  }
  bus.emit("workflow.step.completed", buildStepCompletedPayload(runMetadata, skipped));
  return skipped;
}

type TelemetryArtifact = {
  tools: Record<string, { calls: number; totalMs: number }>;
};

function readToolCallSummary(
  stepId: string,
  runDir: string,
  projectDir: string,
): ToolCallSummaryEntry[] | undefined {
  const path = join(resolve(projectDir, runDir), "steps", `${stepId}.tool-telemetry.json`);
  if (!existsSync(path)) return undefined;
  try {
    const artifact = JSON.parse(readFileSync(path, "utf-8")) as TelemetryArtifact;
    const entries = Object.entries(artifact.tools ?? {});
    if (entries.length === 0) return undefined;
    return entries
      .sort((a, b) => b[1].calls - a[1].calls)
      .map(([tool, s]) => ({ tool, count: s.calls, totalMs: s.totalMs }));
  } catch {
    return undefined;
  }
}

export type SingleStepResult = {
  completed: WorkflowStepResult;
  agentBackoff?: WorkflowAgentBackoffSignal;
  thrownError?: Error;
  truncationWarning?: WorkflowRunWarning;
};

export async function executeWorkflowStep(
  definition: WorkflowDefinition,
  step: WorkflowStep,
  run: Pick<ActiveWorkflowRunHandle, "metadata" | "recordStep" | "appendAgentMessage" | "writeAgentInputs">,
  trigger: WorkflowRunTrigger,
  context: WorkflowStepContext,
  runAbortController: AbortController,
  agentConfig: AgentStepConfig,
  acc: StepAccumulators,
  deps: StepDeps,
  stepStartedAt: number,
): Promise<SingleStepResult> {
  // Per-step abort controller: forwards run-level aborts and enforces the step deadline.
  // Agent steps respond to the abort signal; code/tool steps use Promise.race as a fallback.
  const stepAbortController = new AbortController();
  const forwardRunAbort = () => stepAbortController.abort(runAbortController.signal.reason);
  runAbortController.signal.addEventListener("abort", forwardRunAbort, { once: true });

  const timeoutMs = "timeoutMs" in step ? (step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS) : DEFAULT_STEP_TIMEOUT_MS;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new Error(`Step "${step.id}" timed out after ${timeoutMs}ms`);
      stepAbortController.abort(err);
      reject(err);
    }, timeoutMs);
  });

  try {
    const stepPromise = executeStep(
      definition,
      step,
      run.metadata,
      trigger,
      context,
      stepAbortController,
      (message) => run.appendAgentMessage(step.id, message),
      (systemPromptAppend, prompt) => run.writeAgentInputs(step.id, systemPromptAppend, prompt),
      agentConfig,
    );
    const rawOutput = await Promise.race([stepPromise, timeoutPromise]);
    const stepCostUsd =
      step.type === "agent" &&
      rawOutput != null &&
      typeof rawOutput === "object" &&
      !Array.isArray(rawOutput)
        ? ((rawOutput as Record<string, unknown>).totalCostUsd as number | undefined)
        : undefined;

    const { output, warning: truncationWarning } = applyOutputSizeLimit(
      rawOutput,
      agentConfig.config?.workflow?.maxStepOutputBytes,
    );
    if (truncationWarning) {
      acc.warnings.push(truncationWarning);
      deps.log(`Step "${step.id}" output truncated in workflow "${definition.name}": ${truncationWarning.message}`);
    }

    const toolCalls = step.type === "agent"
      ? readToolCallSummary(step.id, run.metadata.runDir, agentConfig.projectDir)
      : undefined;
    const completed: WorkflowStepResult = {
      id: step.id,
      type: step.type,
      status: "success",
      startedAt: new Date(stepStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stepStartedAt,
      ...(stepCostUsd != null ? { costUsd: stepCostUsd } : {}),
      output,
      ...(toolCalls != null ? { toolCalls } : {}),
    };
    run.recordStep(completed);
    acc.stepOutputsById[step.id] = output;
    acc.stepResultsById[step.id] = completed;
    acc.stepOutputs.push(output);

    deps.bus.emit("workflow.step.completed", buildStepCompletedPayload(run.metadata, completed));
    const logDetails: string[] = [`${completed.durationMs}ms`];
    if (completed.type === "agent" && completed.output && typeof completed.output === "object") {
      const o = completed.output as { turns?: unknown; totalCostUsd?: unknown; subtype?: unknown };
      if (typeof o.turns === "number") logDetails.push(`${o.turns} turn(s)`);
      if (typeof o.totalCostUsd === "number") logDetails.push(`$${o.totalCostUsd.toFixed(2)}`);
      if (typeof o.subtype === "string" && o.subtype) logDetails.push(o.subtype);
    }
    deps.log(
      `Completed step "${completed.id}" (${completed.type}) in workflow "${definition.name}" [${logDetails.join(", ")}]`,
    );
    return { completed, ...(truncationWarning ? { truncationWarning } : {}) };
  } catch (error) {
    // If the step-level controller was aborted by the deadline (not the run-level abort),
    // surface a plain Error so the run gets status "failed" rather than "interrupted".
    const isStepTimeout = stepAbortController.signal.aborted && !runAbortController.signal.aborted;
    const err = isStepTimeout
      ? (() => {
          const reason = stepAbortController.signal.reason;
          return new Error(reason instanceof Error ? reason.message : `Step "${step.id}" timed out`);
        })()
      : error instanceof Error ? error : new Error(String(error));

    let agentBackoff: WorkflowAgentBackoffSignal | undefined;
    if (!isStepTimeout && err instanceof AgentStepRuntimeError) {
      agentBackoff = { kind: err.kind, reason: err.message };
    }
    const failed: WorkflowStepResult = {
      id: step.id,
      type: step.type,
      status: "failed",
      startedAt: new Date(stepStartedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - stepStartedAt,
      error: err.message,
      ...(step.continueOnFailure ? { continueOnFailure: true } : {}),
    };
    run.recordStep(failed);
    acc.stepResultsById[step.id] = failed;
    deps.bus.emit("workflow.step.completed", buildStepCompletedPayload(run.metadata, failed));
    deps.log(
      `Failed step "${failed.id}" (${failed.type}) in workflow "${definition.name}": ${failed.error ?? "unknown error"}`,
    );
    return { completed: failed, agentBackoff, thrownError: err };
  } finally {
    clearTimeout(timeoutHandle);
    runAbortController.signal.removeEventListener("abort", forwardRunAbort);
  }
}
