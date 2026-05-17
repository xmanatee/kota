import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import { safeJsonStringify, writeJsonFile } from "./run-io.js";
import type {
  WorkflowRunMetadata,
  WorkflowRunStatus,
  WorkflowRuntimeState,
  WorkflowRunWarning,
  WorkflowStepResult,
} from "./run-types.js";

export type FinishUpdate = {
  status: WorkflowRunStatus;
  durationMs: number;
  error?: string;
  warnings?: WorkflowRunWarning[];
};

export type ActiveWorkflowRunHandle = {
  metadata: WorkflowRunMetadata;
  appendAgentMessage(stepId: string, message: KotaAgentMessage): void;
  writeAgentInputs(
    stepId: string,
    systemPromptAppend: string | undefined,
    prompt: string,
  ): void;
  recordStep(result: WorkflowStepResult): void;
  finish(update: FinishUpdate): WorkflowRunMetadata;
};

export function createActiveRunHandle(opts: {
  id: string;
  runDirPath: string;
  metadata: WorkflowRunMetadata;
  workflowName: string;
  stepOrder?: ReadonlyMap<string, number>;
  readState: () => WorkflowRuntimeState;
  writeState: (state: WorkflowRuntimeState) => void;
}): ActiveWorkflowRunHandle {
  const { id, runDirPath, metadata, workflowName, stepOrder, readState, writeState } = opts;

  const persistMetadata = () => {
    writeJsonFile(join(runDirPath, "metadata.json"), metadata);
  };

  const recordStepInDefinitionOrder = (result: WorkflowStepResult): void => {
    const existingIndex = metadata.steps.findIndex((step) => step.id === result.id);
    if (existingIndex >= 0) {
      metadata.steps[existingIndex] = result;
      return;
    }

    const resultOrder = stepOrder?.get(result.id) ?? Number.POSITIVE_INFINITY;
    const insertIndex = metadata.steps.findIndex((step) => {
      const existingOrder = stepOrder?.get(step.id) ?? Number.POSITIVE_INFINITY;
      return existingOrder > resultOrder;
    });
    if (insertIndex >= 0) metadata.steps.splice(insertIndex, 0, result);
    else metadata.steps.push(result);
  };

  return {
    metadata,
    appendAgentMessage: (stepId, message) => {
      appendFileSync(
        join(runDirPath, "steps", `${stepId}.events.jsonl`),
        `${safeJsonStringify(message)}\n`,
        "utf-8",
      );
    },
    writeAgentInputs: (stepId, systemPromptAppend, prompt) => {
      const parts = [
        "# System Prompt Appendix",
        "",
        systemPromptAppend || "(none)",
        "",
        "# User Prompt",
        "",
        prompt,
        "",
      ];
      writeFileSync(
        join(runDirPath, "steps", `${stepId}.input.md`),
        parts.join("\n"),
        "utf-8",
      );
    },
    recordStep: (result) => {
      recordStepInDefinitionOrder(result);
      writeJsonFile(join(runDirPath, "steps", `${result.id}.json`), result);
      persistMetadata();
    },
    finish: (update) => {
      const totalCostUsd = metadata.steps
        .filter((s) => s.type === "agent")
        .reduce((sum, s) => {
          if (s.output && typeof s.output === "object" && !Array.isArray(s.output)) {
            const cost = (s.output as Record<string, unknown>).totalCostUsd;
            if (typeof cost === "number") return sum + cost;
          }
          return sum;
        }, 0);
      const completed: WorkflowRunMetadata = {
        ...metadata,
        status: update.status,
        completedAt: new Date().toISOString(),
        durationMs: update.durationMs,
        totalCostUsd,
        ...(update.warnings && update.warnings.length > 0 ? { warnings: update.warnings } : {}),
      };
      if (update.error) {
        writeFileSync(join(runDirPath, "error.txt"), update.error, "utf-8");
      }

      writeJsonFile(join(runDirPath, "metadata.json"), completed);

      // Re-read state immediately before writing to minimize the race window.
      // Merge carefully: only advance lastCompletion forward so a concurrent
      // finish() cannot overwrite a more recent completion with an older one.
      const freshState = readState();
      freshState.completedRuns += 1;
      freshState.totalCostUsd = (freshState.totalCostUsd ?? 0) + totalCostUsd;
      const existingWorkflow = freshState.workflows[workflowName];
      const existingCompletedMs = existingWorkflow?.lastCompletion?.completedAt
        ? new Date(existingWorkflow.lastCompletion.completedAt).getTime()
        : 0;
      const thisCompletedMs = new Date(completed.completedAt!).getTime();
      if (thisCompletedMs >= existingCompletedMs) {
        freshState.workflows[workflowName] = {
          ...existingWorkflow,
          lastCompletion: {
            runId: id,
            startedAt: metadata.startedAt,
            completedAt: completed.completedAt!,
            status: update.status,
          },
        };
      }
      freshState.activeRuns = (freshState.activeRuns ?? []).filter(
        (r) => r.runId !== id,
      );
      writeState(freshState);

      return completed;
    },
  };
}
