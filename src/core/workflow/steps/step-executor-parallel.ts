import type { SDKMessage } from "#core/agent-sdk/types.js";
import type { ActiveWorkflowRunHandle } from "../active-run-handle.js";
import { DEFAULT_STEP_TIMEOUT_MS } from "../run-executor-step.js";
import type { WorkflowStepContext, WorkflowStepResult, WorkflowStepSkipReason } from "../run-types.js";
import type { WorkflowDefinition, WorkflowParallelGroup, WorkflowRunTrigger } from "../types.js";
import { evaluateStepRunDecision, executeCodeStep } from "./step-executor.js";
import type { AgentStepConfig } from "./step-executor-agent.js";
import { executeAgentStep } from "./step-executor-agent.js";

export type ParallelGroupResult = {
  groupResult: WorkflowStepResult;
  innerResults: WorkflowStepResult[];
  hadNewWarnings: boolean;
  groupFailed: boolean;
};

type ParallelChildOutcome =
  | {
      childStep: WorkflowParallelGroup["steps"][number];
      skipped: true;
      skipReason: WorkflowStepSkipReason;
      output: unknown;
    }
  | {
      childStep: WorkflowParallelGroup["steps"][number];
      skipped: false;
      output: unknown;
      harness?: string;
      model?: string;
    };

/** Deps required only when the parallel group contains agent steps. */
export type ParallelAgentDeps = {
  definition: WorkflowDefinition;
  run: Pick<ActiveWorkflowRunHandle, "metadata" | "appendAgentMessage" | "writeAgentInputs">;
  trigger: WorkflowRunTrigger;
  runAbortController: AbortController;
  agentConfig: AgentStepConfig;
};

class Semaphore {
  private slots: number;
  private waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.slots = limit;
  }

  async acquire(): Promise<void> {
    if (this.slots > 0) {
      this.slots--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.slots++;
    }
  }
}

export async function executeParallelStepGroup(
  step: WorkflowParallelGroup,
  context: WorkflowStepContext,
  stepStartedAt: number,
  agentDeps?: ParallelAgentDeps,
): Promise<ParallelGroupResult> {
  const childStartedAt = new Date(stepStartedAt).toISOString();
  const agentStepCount = step.steps.filter((s) => s.type === "agent").length;
  const semaphore = agentStepCount > 0 && step.maxParallelAgents !== undefined
    ? new Semaphore(step.maxParallelAgents)
    : null;

  const childResults = await Promise.allSettled(
    step.steps.map(async (childStep) => {
      const runDecision = await evaluateStepRunDecision(childStep, context);
      if (!runDecision.run) {
        return { childStep, skipped: true as const, skipReason: runDecision.skipReason, output: null as unknown };
      }

      if (childStep.type === "agent") {
        if (!agentDeps) {
          throw new Error(
            `Parallel group "${step.id}" contains agent step "${childStep.id}" but no agent deps were provided`,
          );
        }
        if (semaphore) await semaphore.acquire();
        try {
          const timeoutMs = childStep.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
          const stepAbortController = new AbortController();
          const forwardAbort = () => stepAbortController.abort(agentDeps.runAbortController.signal.reason);
          agentDeps.runAbortController.signal.addEventListener("abort", forwardAbort, { once: true });

          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              const err = new Error(`Step "${childStep.id}" timed out after ${timeoutMs}ms`);
              stepAbortController.abort(err);
              reject(err);
            }, timeoutMs);
          });

          try {
            const agentPromise = executeAgentStep(
              agentDeps.definition,
              childStep,
              agentDeps.run.metadata,
              agentDeps.trigger,
              stepAbortController,
              (message: SDKMessage) => agentDeps.run.appendAgentMessage(childStep.id, message),
              (systemPromptAppend: string | undefined, prompt: string) =>
                agentDeps.run.writeAgentInputs(childStep.id, systemPromptAppend, prompt),
              agentDeps.agentConfig,
              context.stepOutputs,
            );
            const agentResult = await Promise.race([agentPromise, timeoutPromise]);
            return {
              childStep,
              skipped: false as const,
              output: agentResult.output,
              harness: agentResult.harness,
              model: agentResult.model,
            };
          } finally {
            clearTimeout(timeoutHandle);
            agentDeps.runAbortController.signal.removeEventListener("abort", forwardAbort);
          }
        } finally {
          if (semaphore) semaphore.release();
        }
      }

      const output = await executeCodeStep(childStep, context);
      return { childStep, skipped: false as const, output };
    }),
  ) as Array<PromiseSettledResult<ParallelChildOutcome>>;

  let groupFailed = false;
  let hadNewWarnings = false;
  const innerResults: WorkflowStepResult[] = [];
  const childCompletedAt = new Date().toISOString();

  for (let i = 0; i < step.steps.length; i++) {
    const childStep = step.steps[i];
    const result = childResults[i];
    if (result.status === "fulfilled") {
      if (result.value.skipped) {
        const childSkipped: WorkflowStepResult = {
          id: childStep.id,
          type: childStep.type,
          status: "skipped",
          startedAt: childStartedAt,
          completedAt: childCompletedAt,
          durationMs: 0,
          skipReason: result.value.skipReason,
        };
        innerResults.push(childSkipped);
      } else {
        const { harness, model } = result.value;
        innerResults.push({
          id: childStep.id,
          type: childStep.type,
          status: "success",
          startedAt: childStartedAt,
          completedAt: childCompletedAt,
          durationMs: 0,
          output: result.value.output,
          ...(harness != null ? { harness } : {}),
          ...(model != null ? { model } : {}),
        });
      }
    } else {
      const err = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
      innerResults.push({
        id: childStep.id,
        type: childStep.type,
        status: "failed",
        startedAt: childStartedAt,
        completedAt: childCompletedAt,
        durationMs: 0,
        error: err.message,
        ...(childStep.continueOnFailure ? { continueOnFailure: true } : {}),
      });
      if (childStep.continueOnFailure) hadNewWarnings = true;
      else groupFailed = true;
    }
  }

  const groupOutput = { steps: innerResults };
  const groupResult: WorkflowStepResult = {
    id: step.id,
    type: "parallel",
    status: groupFailed ? "failed" : "success",
    startedAt: new Date(stepStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - stepStartedAt,
    output: groupOutput,
    ...(step.continueOnFailure && groupFailed ? { continueOnFailure: true } : {}),
  };

  return { groupResult, innerResults, hadNewWarnings, groupFailed };
}
