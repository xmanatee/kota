import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KotaConfig } from "../config.js";
import type { EventBus } from "../event-bus.js";
import { executeTool } from "../tools/index.js";
import {
  buildStepCompletedPayload,
  buildStepStartedPayload,
  buildWorkflowCompletedPayload,
} from "./event-payloads.js";
import type { WorkflowRunStore } from "./run-store.js";
import {
  type AgentStepConfig,
  executeStep,
  shouldRunStep,
} from "./step-executor.js";
import type {
  WorkflowDefinition,
  WorkflowFilterValue,
  WorkflowRunMetadata,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  WorkflowRuntimeState,
  WorkflowStepContext,
  WorkflowStepResult,
} from "./types.js";

export type RunExecutorDeps = {
  projectDir: string;
  bus: EventBus;
  store: WorkflowRunStore;
  model?: string;
  config?: KotaConfig;
  log: (message: string) => void;
};

export function matchesFilter(
  filter: Record<string, WorkflowFilterValue> | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (!filter) return true;
  for (const [key, expected] of Object.entries(filter)) {
    const actual = payload[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual as string | number | boolean)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

export function getEligibleAtMs(
  workflowName: string,
  cooldownMs: number,
  state: WorkflowRuntimeState,
): number {
  const lastCompletedAt = state.workflows[workflowName]?.lastCompletedAt;
  if (!lastCompletedAt || cooldownMs <= 0) return Date.now();
  return new Date(lastCompletedAt).getTime() + cooldownMs;
}

export function createStepContext(
  metadata: WorkflowRunMetadata,
  trigger: WorkflowRunTrigger,
  previousOutput: unknown,
  stepOutputsById: Record<string, unknown>,
  stepResultsById: Record<string, WorkflowStepResult>,
  stepOutputList: unknown[],
  deps: Pick<RunExecutorDeps, "projectDir" | "bus" | "store">,
): WorkflowStepContext {
  const runDirPath = resolve(deps.projectDir, metadata.runDir);
  return {
    projectDir: deps.projectDir,
    workflow: {
      name: metadata.workflow,
      definitionPath: metadata.definitionPath,
      runId: metadata.id,
      runDir: metadata.runDir,
      runDirPath,
    },
    trigger,
    previousOutput,
    stepOutputs: stepOutputsById,
    stepResults: stepResultsById,
    stepOutputList,
    runTool: async (name, input) => {
      const result = await executeTool(name, input);
      if (result.is_error) {
        throw new Error(result.content);
      }
      return result;
    },
    emit: (event, payload) => {
      deps.bus.emit(event, payload);
    },
    requestRestart: (reason) => {
      deps.bus.emit("runtime.restart_requested", {
        reason,
        workflow: metadata.workflow,
        runId: metadata.id,
      });
    },
    readPrompt: (promptPath) => {
      return readFileSync(resolve(deps.projectDir, promptPath), "utf-8");
    },
    readRuntimeState: () => deps.store.readState(),
  };
}

export function executeWorkflowRun(
  definition: WorkflowDefinition,
  trigger: WorkflowRunTrigger,
  deps: RunExecutorDeps,
  onComplete: () => void,
): { promise: Promise<void>; abortController: AbortController } {
  const run = deps.store.createRun(definition, trigger);
  const startedAt = Date.now();
  const abortController = new AbortController();

  let runTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (definition.runTimeoutMs !== undefined) {
    runTimeoutHandle = setTimeout(() => {
      abortController.abort(
        new Error(`Workflow "${definition.name}" run timed out after ${definition.runTimeoutMs}ms`),
      );
    }, definition.runTimeoutMs);
  }

  deps.bus.emit("workflow.started", {
    workflow: definition.name,
    runId: run.metadata.id,
    triggerEvent: trigger.event,
    definitionPath: run.metadata.definitionPath,
    runDir: run.metadata.runDir,
    startedAt: run.metadata.startedAt,
  });
  deps.log(`Starting workflow "${definition.name}" (${run.metadata.id})`);

  const promise = (async () => {
    const stepOutputsById: Record<string, unknown> = {};
    const stepResultsById: Record<string, WorkflowStepResult> = {};
    const stepOutputs: unknown[] = [];
    let previousOutput: unknown = null;

    try {
      for (const step of definition.steps) {
        const context = createStepContext(
          run.metadata,
          trigger,
          previousOutput,
          stepOutputsById,
          stepResultsById,
          stepOutputs,
          deps,
        );
        const stepStartedAt = Date.now();

        const agentConfig: AgentStepConfig = {
          model: deps.model,
          config: deps.config,
          projectDir: deps.projectDir,
          log: deps.log,
        };

        if (!(await shouldRunStep(step, context))) {
          const skipped: WorkflowStepResult = {
            id: step.id,
            type: step.type,
            status: "skipped",
            startedAt: new Date(stepStartedAt).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - stepStartedAt,
          };
          run.recordStep(skipped);
          stepOutputsById[step.id] = { skipped: true };
          stepResultsById[step.id] = skipped;
          stepOutputs.push({ skipped: true });
          deps.bus.emit(
            "workflow.step.completed",
            buildStepCompletedPayload(run.metadata, skipped),
          );
          continue;
        }

        deps.bus.emit(
          "workflow.step.started",
          buildStepStartedPayload(run.metadata, step),
        );
        deps.log(`Starting step "${step.id}" (${step.type}) in workflow "${definition.name}"`);
        try {
          const output = await executeStep(
            definition,
            step,
            run.metadata,
            trigger,
            context,
            abortController,
            (message) => run.appendAgentMessage(step.id, message),
            (systemPromptAppend, prompt) =>
              run.writeAgentInputs(step.id, systemPromptAppend, prompt),
            agentConfig,
          );

          const completed: WorkflowStepResult = {
            id: step.id,
            type: step.type,
            status: "success",
            startedAt: new Date(stepStartedAt).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - stepStartedAt,
            output,
          };
          run.recordStep(completed);
          stepOutputsById[step.id] = output;
          stepResultsById[step.id] = completed;
          stepOutputs.push(output);
          previousOutput = output;

          deps.bus.emit(
            "workflow.step.completed",
            buildStepCompletedPayload(run.metadata, completed),
          );
          const logDetails: string[] = [`${completed.durationMs}ms`];
          if (completed.type === "agent" && completed.output && typeof completed.output === "object") {
            const o = completed.output as { turns?: unknown; totalCostUsd?: unknown; subtype?: unknown };
            if (typeof o.turns === "number") logDetails.push(`${o.turns} turn(s)`);
            if (typeof o.totalCostUsd === "number") logDetails.push(`$${o.totalCostUsd.toFixed(2)}`);
            if (typeof o.subtype === "string" && o.subtype) logDetails.push(o.subtype);
          }
          deps.log(`Completed step "${completed.id}" (${completed.type}) in workflow "${definition.name}" [${logDetails.join(", ")}]`);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          const failed: WorkflowStepResult = {
            id: step.id,
            type: step.type,
            status: "failed",
            startedAt: new Date(stepStartedAt).toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - stepStartedAt,
            error: err.message,
          };
          run.recordStep(failed);
          stepResultsById[step.id] = failed;
          deps.bus.emit(
            "workflow.step.completed",
            buildStepCompletedPayload(run.metadata, failed),
          );
          deps.log(`Failed step "${failed.id}" (${failed.type}) in workflow "${definition.name}": ${failed.error ?? "unknown error"}`);
          throw err;
        }
      }

      const completed = run.finish({
        status: "success",
        durationMs: Date.now() - startedAt,
      });
      deps.bus.emit(
        "workflow.completed",
        buildWorkflowCompletedPayload(completed, "success"),
      );
      deps.log(`Completed workflow "${definition.name}" (${completed.id})`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const status: WorkflowRunStatus =
        abortController.signal.aborted || err.name === "AbortError"
          ? "interrupted"
          : "failed";
      const completed = run.finish({
        status,
        durationMs: Date.now() - startedAt,
        error: err.message,
      });
      deps.bus.emit(
        "workflow.completed",
        buildWorkflowCompletedPayload(completed, status),
      );
      deps.log(
        `${status === "interrupted" ? "Interrupted" : "Failed"} workflow "${definition.name}" (${completed.id}): ${err.message}`,
      );
    } finally {
      clearTimeout(runTimeoutHandle);
      onComplete();
    }
  })();

  return { promise, abortController };
}
