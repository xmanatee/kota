import { resolveAgentHarness } from "#core/agent-harness/index.js";
import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import {
  agentRunDirWriteScopes,
  resolveAgentRunDir,
} from "./agent-run-dir.js";
import {
  type RepairLoopAccounting,
  recordRepairIteration,
} from "./repair-loop-accounting.js";
import {
  executeRepairAgentIteration,
  RepairAgentIterationError,
  type RepairAgentIterationResult,
} from "./repair-loop-agent-iteration.js";
import {
  type RepairCheckResult,
  runChecksPhased,
} from "./repair-loop-checks.js";
import { createRepairContinuationEvaluator } from "./repair-loop-continuation.js";
import {
  repairProgressSnapshot,
  stageWorkflowChangesForRepairChecks,
} from "./repair-loop-progress.js";
import { buildRepairPrompt } from "./repair-loop-prompt.js";
import {
  createRepairLoopResultWrapper,
  resolveScopedRepairAgent,
} from "./repair-loop-result.js";
import {
  RepairAgentRuntimeError,
  type RepairIteration,
  RepairLoopError,
  type RepairLoopFailureOutput,
} from "./repair-loop-types.js";
import { enforceRepairAgentWriteScope } from "./repair-loop-write-scope.js";
import type {
  WorkflowRepairContinuationDecision,
  WorkflowRunMetadata,
  WorkflowStepContext,
} from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import { requiresWriteScopeSnapshot } from "./steps/agent-write-scope.js";
import { captureWorkflowMutationSnapshot } from "./steps/agent-write-scope-snapshot.js";
import type { AgentStepConfig, AgentStepResult } from "./steps/step-executor-agent.js";
import { writeAgentTokenBudgetArtifact } from "./steps/step-executor-agent-token-budget.js";
import { AgentStepRuntimeError } from "./steps/step-executor-retry.js";

export type { RepairCheckResult } from "./repair-loop-checks.js";
export { buildRepairPrompt } from "./repair-loop-prompt.js";
export {
  RepairAgentRuntimeError,
  type RepairIteration,
  RepairLoopError,
  type RepairLoopFailureOutput,
  RepairLoopYield,
} from "./repair-loop-types.js";

const REPAIR_NO_PROGRESS_LIMIT = 3;

export async function runAgentRepairLoop(
  step: WorkflowAgentStep,
  initialResult: AgentStepResult,
  context: WorkflowStepContext,
  metadata: WorkflowRunMetadata,
  abortController: AbortController,
  appendMessage: (message: KotaAgentMessage) => void,
  agentConfig: AgentStepConfig,
): Promise<AgentStepResult> {
  const { checks, maxRepairAttempts } = step.repairLoop!;
  const iterations: RepairIteration[] = [];
  const base = (initialResult.output && typeof initialResult.output === "object") ? initialResult.output as Record<string, unknown> : {};
  const accounting: RepairLoopAccounting = {
    turns: typeof base.turns === "number" ? base.turns : 0,
    totalCostUsd: typeof base.totalCostUsd === "number" ? base.totalCostUsd : 0,
    inputTokens: typeof base.inputTokens === "number" ? base.inputTokens : 0,
    outputTokens: typeof base.outputTokens === "number" ? base.outputTokens : 0,
    sessionId: typeof base.sessionId === "string" ? base.sessionId : undefined,
    content: typeof base.content === "string" ? base.content : "",
  };
  let warnings = [] as RepairCheckResult[];
  const continuationDecisions: WorkflowRepairContinuationDecision[] = [];
  const trajectoryMessages = [...initialResult.trajectoryMessages];
  const resolvedHarness = resolveAgentHarness(step.harness);
  const scopedAgent = resolveScopedRepairAgent(step, agentConfig);
  const workspaceDir = context.workspaceDir ?? context.projectDir;
  const agentRunDir = resolveAgentRunDir({
    metadata,
    projectDir: context.projectDir,
    runtimeResources: context.runtimeResources,
  });
  const agentOutputWriteScopes = agentRunDirWriteScopes(
    workspaceDir,
    agentRunDir,
  );
  const currentOutput = (): RepairLoopFailureOutput => ({
    ...base,
    content: accounting.content,
    turns: accounting.turns,
    totalCostUsd: accounting.totalCostUsd,
    inputTokens: accounting.inputTokens,
    outputTokens: accounting.outputTokens,
    ...(accounting.sessionId === undefined
      ? {}
      : { sessionId: accounting.sessionId }),
    repairIterations: iterations,
    repairWarnings: warnings,
    continuationDecisions,
  });
  const wrap = createRepairLoopResultWrapper({
    step,
    initialResult,
    context,
    metadata,
    resolvedHarness,
    trajectoryMessages,
    scopedAgent,
    workspaceDir,
  });
  const evaluateContinuation = createRepairContinuationEvaluator({
    controller: step.repairLoop?.continuation,
    context,
    step,
    decisions: continuationDecisions,
    failureOutput: currentOutput,
  });

  if (abortController.signal.aborted) {
    return wrap(currentOutput());
  }

  await stageWorkflowChangesForRepairChecks(workspaceDir);
  const { failures: initialFailures, warnings: initialWarnings } = await runChecksPhased(checks, context, step);
  let failures = initialFailures;
  warnings = initialWarnings;
  let previousProgress = await repairProgressSnapshot(workspaceDir, failures);
  let noProgressAttempts = 0;

  if (failures.length > 0) {
    await evaluateContinuation({
      attempt: 0,
      failureIds: failures.map((failure) => failure.id),
      warningIds: warnings.map((warning) => warning.id),
      progressKey: previousProgress.key,
      previousProgressKey: previousProgress.key,
      progressChanged: false,
      noProgressAttempts,
      repairIterations: [],
    });
  }

  for (let attempt = 1; failures.length > 0 && (maxRepairAttempts === undefined || attempt <= maxRepairAttempts); attempt++) {
    if (abortController.signal.aborted) break;

    const iteration: RepairIteration = { attempt, failures };

    const repairPrompt = buildRepairPrompt(attempt, maxRepairAttempts, failures, step, agentRunDir);
    const appendRepairMessage = (message: KotaAgentMessage) => {
      trajectoryMessages.push(message);
      appendMessage(message);
    };
    const repairPreSnapshot =
      scopedAgent && requiresWriteScopeSnapshot(scopedAgent.writeScope)
        ? captureWorkflowMutationSnapshot(workspaceDir)
        : undefined;
    let repairAttempt:
      | {
          ok: true;
          result: RepairAgentIterationResult;
        }
      | { ok: false; error: Error };
    try {
      repairAttempt = {
        ok: true,
        result: await executeRepairAgentIteration(
          step,
          repairPrompt,
          context,
          metadata,
          abortController,
          appendRepairMessage,
          agentConfig,
          initialResult.tokenBudget,
          accounting.sessionId,
        ),
      };
    } catch (error) {
      repairAttempt = {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } finally {
      writeAgentTokenBudgetArtifact(
        step.id,
        metadata,
        context.projectDir,
        initialResult.tokenBudget,
      );
    }

    if (scopedAgent && repairPreSnapshot) {
      enforceRepairAgentWriteScope({
        preSnapshot: repairPreSnapshot,
        workspaceDir,
        runtimeWriteScopes: agentOutputWriteScopes,
        scopedAgent,
        stepId: step.id,
        metadata,
        projectDir: context.projectDir,
      });
    }
    if (!repairAttempt.ok) {
      const failedIteration = repairAttempt.error instanceof RepairAgentIterationError
        ? repairAttempt.error
        : undefined;
      iteration.agentError = repairAttempt.error.message;
      if (failedIteration !== undefined) {
        recordRepairIteration(accounting, iterations, iteration, failedIteration.result);
      } else {
        iterations.push(iteration);
      }
      const agentBackoff = failedIteration?.agentBackoff ??
        (repairAttempt.error instanceof AgentStepRuntimeError
          ? repairAttempt.error
          : undefined);
      if (failedIteration?.agentBackoff !== undefined) {
        throw new RepairAgentRuntimeError(
          failedIteration.agentBackoff,
          step.id,
          failures.map((failure) => failure.id),
          currentOutput(),
        );
      }
      throw new RepairLoopError(
        undefined,
        step.id,
        failures.map((failure) => failure.id),
        currentOutput(),
        repairAttempt.error.message,
        agentBackoff,
      );
    }
    const repairResult = repairAttempt.result;
    recordRepairIteration(accounting, iterations, iteration, repairResult);

    if (abortController.signal.aborted) break;

    await stageWorkflowChangesForRepairChecks(workspaceDir);
    const phased = await runChecksPhased(checks, context, step);
    failures = phased.failures;
    warnings = phased.warnings;

    if (failures.length > 0) {
      const progress = await repairProgressSnapshot(workspaceDir, failures);
      const progressChanged = progress.key !== previousProgress.key;
      noProgressAttempts = progressChanged ? 0 : noProgressAttempts + 1;
      await evaluateContinuation({
        attempt,
        failureIds: failures.map((failure) => failure.id),
        warningIds: warnings.map((warning) => warning.id),
        progressKey: progress.key,
        previousProgressKey: previousProgress.key,
        progressChanged,
        noProgressAttempts,
        repairIterations: iterations.map((candidate) => ({
          attempt: candidate.attempt,
          failureIds: candidate.failures.map((failure) => failure.id),
        })),
      });
      if (progressChanged) previousProgress = progress;
      if (noProgressAttempts >= REPAIR_NO_PROGRESS_LIMIT) {
        throw new RepairLoopError(
          "repair-no-progress",
          step.id,
          progress.failureIds,
          currentOutput(),
          `Repair loop for step "${step.id}" made no progress after ${REPAIR_NO_PROGRESS_LIMIT} consecutive attempts. ` +
            `Still failing: ${progress.failureIds.join(", ")}`,
        );
      }
    }

    if (failures.length > 0 && attempt === maxRepairAttempts) {
      throw new RepairLoopError(
        "repair-attempts-exhausted",
        step.id,
        failures.map((failure) => failure.id),
        currentOutput(),
        `Repair loop for step "${step.id}" exhausted repair attempts (${maxRepairAttempts}). ` +
          `Still failing: ${failures.map((f) => f.id).join(", ")}`,
      );
    }
  }

  return wrap(currentOutput());
}
