import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import { redactSensitiveText } from "#core/evidence/policy.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { writeControlMonitorCoverageArtifactBestEffort } from "./control-monitor-coverage.js";
import { triggerPayloadLinkedRunIds } from "./control-monitor-coverage-readers.js";
import {
  formatProjectedEvidenceText,
  projectKotaAgentMessageForStorage,
  projectProviderPayloadText,
  projectWorkflowRunMetadataForStorage,
  projectWorkflowStepResultForStorage,
} from "./run-evidence.js";
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
  projectDir?: string;
  runDirPath: string;
  metadata: WorkflowRunMetadata;
  workflowName: string;
  stepOrder?: ReadonlyMap<string, number>;
  readState: () => WorkflowRuntimeState;
  writeState: (state: WorkflowRuntimeState) => void;
}): ActiveWorkflowRunHandle {
  const { id, runDirPath, metadata, workflowName, stepOrder, readState, writeState } = opts;
  const projectDir = opts.projectDir ?? dirname(dirname(dirname(runDirPath)));

  const persistMetadata = () => {
    writeJsonFile(
      join(runDirPath, "metadata.json"),
      projectWorkflowRunMetadataForStorage(metadata),
    );
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

  const persistControlCoverage = (
    targetRunDirPath: string,
    completed: WorkflowRunMetadata,
    errorArtifact: string,
  ): void => {
    writeControlMonitorCoverageArtifactBestEffort({
      projectDir,
      runDirPath: targetRunDirPath,
      metadata: completed,
      errorArtifact,
      errorRunDirPath: runDirPath,
    });
  };

  const linkedSourceRunIds = (completed: WorkflowRunMetadata): string[] => {
    const ids = [
      completed.causedBy?.runId,
      completed.triggeredByRunId,
      ...triggerPayloadLinkedRunIds(completed.trigger.payload),
    ];
    return [...new Set(ids.filter((value): value is string =>
      value !== undefined && value !== completed.id
    ))];
  };

  const refreshLinkedControlCoverage = (completed: WorkflowRunMetadata): void => {
    for (const sourceRunId of linkedSourceRunIds(completed)) {
      const sourceRunDirPath = join(projectDir, ".kota", "runs", sourceRunId);
      const sourceMetadata = readOptionalJsonFile<WorkflowRunMetadata>(
        join(sourceRunDirPath, "metadata.json"),
      );
      if (!sourceMetadata) continue;
      persistControlCoverage(
        sourceRunDirPath,
        sourceMetadata,
        "control-monitor-coverage-refresh-error.txt",
      );
    }
  };

  return {
    metadata,
    appendAgentMessage: (stepId, message) => {
      appendFileSync(
        join(runDirPath, "steps", `${stepId}.events.jsonl`),
        `${safeJsonStringify(projectKotaAgentMessageForStorage(message))}\n`,
        "utf-8",
      );
    },
    writeAgentInputs: (stepId, systemPromptAppend, prompt) => {
      const parts = [
        "# System Prompt Appendix",
        "",
        systemPromptAppend
          ? formatProjectedEvidenceText(projectProviderPayloadText(systemPromptAppend))
          : "(none)",
        "",
        "# User Prompt",
        "",
        formatProjectedEvidenceText(projectProviderPayloadText(prompt)),
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
      writeJsonFile(
        join(runDirPath, "steps", `${result.id}.json`),
        projectWorkflowStepResultForStorage(result),
      );
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
        writeFileSync(
          join(runDirPath, "error.txt"),
          redactSensitiveText(update.error),
          "utf-8",
        );
      }

      writeJsonFile(
        join(runDirPath, "metadata.json"),
        projectWorkflowRunMetadataForStorage(completed),
      );
      persistControlCoverage(
        runDirPath,
        completed,
        "control-monitor-coverage-error.txt",
      );

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
      refreshLinkedControlCoverage(completed);

      return completed;
    },
  };
}
