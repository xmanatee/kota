import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import { redactSensitiveText } from "#core/evidence/policy.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  CONTROL_MONITOR_COVERAGE_ARTIFACT,
  type ControlMonitorCoverageArtifact,
  writeControlMonitorCoverageArtifactBestEffort,
} from "./control-monitor-coverage.js";
import { triggerPayloadLinkedRunIds } from "./control-monitor-coverage-readers.js";
import {
  formatProjectedEvidenceText,
  projectKotaAgentMessageForStorage,
  projectProviderPayloadText,
  projectWorkflowRunMetadataForStorage,
  projectWorkflowStepResultForStorage,
} from "./run-evidence.js";
import { safeJsonStringify, validateWorkflowRunId, writeJsonFile } from "./run-io.js";
import type {
  WorkflowRunMetadata,
  WorkflowRunStatus,
  WorkflowRunWarning,
  WorkflowStepResult,
} from "./run-types.js";

export type FinishUpdate = {
  status: WorkflowRunStatus;
  durationMs: number;
  activeDurationMs?: number;
  hostSuspendedMs?: number;
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

function stepInputTokens(step: WorkflowStepResult): number {
  if (step.inputTokens !== undefined) return step.inputTokens;
  if (step.type !== "agent") return 0;
  const output = step.output;
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return 0;
  }
  const value = (output as { inputTokens?: number }).inputTokens;
  return typeof value === "number" ? value : 0;
}

function stepOutputTokens(step: WorkflowStepResult): number {
  if (step.outputTokens !== undefined) return step.outputTokens;
  if (step.type !== "agent") return 0;
  const output = step.output;
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return 0;
  }
  const value = (output as { outputTokens?: number }).outputTokens;
  return typeof value === "number" ? value : 0;
}

export function createActiveRunHandle(opts: {
  id: string;
  projectDir?: string;
  runDirPath: string;
  metadata: WorkflowRunMetadata;
  headSha: string | null;
  stepOrder?: ReadonlyMap<string, number>;
}): ActiveWorkflowRunHandle {
  const {
    runDirPath,
    metadata,
    headSha,
    stepOrder,
  } = opts;
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
    targetHeadSha: string | null,
  ): void => {
    writeControlMonitorCoverageArtifactBestEffort({
      projectDir,
      runDirPath: targetRunDirPath,
      metadata: completed,
      headSha: targetHeadSha,
      errorArtifact,
      errorRunDirPath: runDirPath,
    });
  };

  const runsDirPath = resolve(projectDir, ".kota", "runs");

  const pathInsideDirectory = (parentPath: string, childPath: string): boolean => {
    const relativePath = relative(parentPath, childPath);
    return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
  };

  const linkedSourceRunDirPath = (sourceRunId: string): string | null => {
    try {
      validateWorkflowRunId(sourceRunId, "Linked workflow source");
    } catch {
      return null;
    }
    const sourceRunDirPath = resolve(runsDirPath, sourceRunId);
    return pathInsideDirectory(runsDirPath, sourceRunDirPath) ? sourceRunDirPath : null;
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
      const sourceRunDirPath = linkedSourceRunDirPath(sourceRunId);
      if (sourceRunDirPath === null) continue;
      const sourceMetadata = readOptionalJsonFile<WorkflowRunMetadata>(
        join(sourceRunDirPath, "metadata.json"),
      );
      if (!sourceMetadata) continue;
      persistControlCoverage(
        sourceRunDirPath,
        sourceMetadata,
        "control-monitor-coverage-refresh-error.txt",
        readOptionalJsonFile<ControlMonitorCoverageArtifact>(
          join(sourceRunDirPath, CONTROL_MONITOR_COVERAGE_ARTIFACT),
        )?.run.headSha ?? null,
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
        .reduce((sum, step) => sum + (step.costUsd ?? 0), 0);
      const inputTokens = metadata.steps.reduce(
        (sum, step) => sum + stepInputTokens(step),
        0,
      );
      const outputTokens = metadata.steps.reduce(
        (sum, step) => sum + stepOutputTokens(step),
        0,
      );
      const completed: WorkflowRunMetadata = {
        ...metadata,
        status: update.status,
        completedAt: new Date().toISOString(),
        durationMs: update.durationMs,
        ...(update.activeDurationMs !== undefined
          ? { activeDurationMs: update.activeDurationMs }
          : {}),
        ...(update.hostSuspendedMs !== undefined
          ? { hostSuspendedMs: update.hostSuspendedMs }
          : {}),
        totalCostUsd,
        inputTokens,
        outputTokens,
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
        headSha,
      );

      refreshLinkedControlCoverage(completed);

      return completed;
    },
  };
}
