import { resolveAgentHarness } from "#core/agent-harness/index.js";
import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import { resolveAgentRunDir } from "./agent-run-dir.js";
import {
  executeRepairAgentIteration,
  RepairAgentIterationError,
  type RepairAgentIterationResult,
} from "./repair-loop-agent-iteration.js";
import {
  type RepairCheckResult,
  runChecksPhased,
} from "./repair-loop-checks.js";
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
import type {
  WorkflowRunMetadata,
  WorkflowStepContext,
} from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import {
  AgentWriteScopeViolationError,
  findWriteScopeViolations,
  requiresWriteScopeSnapshot,
  writeWriteScopeViolationArtifact,
} from "./steps/agent-write-scope.js";
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
  let totalTurns = typeof base.turns === "number" ? base.turns : 0;
  let totalCostUsd = typeof base.totalCostUsd === "number" ? base.totalCostUsd : 0;
  let inputTokens = typeof base.inputTokens === "number" ? base.inputTokens : 0;
  let outputTokens = typeof base.outputTokens === "number" ? base.outputTokens : 0;
  let logicalAttemptSessionId = typeof base.sessionId === "string"
    ? base.sessionId
    : undefined;
  let lastContent = typeof base.content === "string" ? base.content : "";
  let warnings = [] as RepairCheckResult[];
  const trajectoryMessages = [...initialResult.trajectoryMessages];
  const resolvedHarness = resolveAgentHarness(step.harness);
  const scopedAgent = resolveScopedRepairAgent(step, agentConfig);
  const workspaceDir = context.workspaceDir ?? context.projectDir;
  const agentRunDir = resolveAgentRunDir({
    metadata,
    projectDir: context.projectDir,
    runtimeResources: context.runtimeResources,
  });
  const failureOutput = (): RepairLoopFailureOutput => ({
    content: lastContent,
    turns: totalTurns,
    totalCostUsd,
    inputTokens,
    outputTokens,
    ...(logicalAttemptSessionId === undefined
      ? {}
      : { sessionId: logicalAttemptSessionId }),
    repairIterations: iterations,
    repairWarnings: warnings,
  });
  const recordRepairResult = (
    iteration: RepairIteration,
    result: RepairAgentIterationResult,
  ): void => {
    iteration.agentResponse = result.text;
    iteration.agentTurns = result.turns;
    iteration.agentCostUsd = result.totalCostUsd;
    iteration.agentInputTokens = result.inputTokens;
    iteration.agentOutputTokens = result.outputTokens;
    iteration.agentSessionId = result.sessionId;
    iterations.push(iteration);

    lastContent = result.text;
    totalTurns += result.turns ?? 0;
    totalCostUsd += result.totalCostUsd ?? 0;
    inputTokens += result.inputTokens ?? 0;
    outputTokens += result.outputTokens ?? 0;
    logicalAttemptSessionId = result.sessionId ?? logicalAttemptSessionId;
  };
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

  if (abortController.signal.aborted) {
    return wrap({
      ...base,
      content: lastContent,
      turns: totalTurns,
      totalCostUsd,
      inputTokens,
      outputTokens,
      repairIterations: iterations,
      repairWarnings: warnings,
    });
  }

  await stageWorkflowChangesForRepairChecks(workspaceDir);
  const { failures: initialFailures, warnings: initialWarnings } = await runChecksPhased(checks, context, step);
  let failures = initialFailures;
  warnings = initialWarnings;
  let previousProgress = await repairProgressSnapshot(workspaceDir, failures);
  let noProgressAttempts = 0;

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
          logicalAttemptSessionId,
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
      const violations = findWriteScopeViolations(
        repairPreSnapshot.changedPathsSince(
          captureWorkflowMutationSnapshot(workspaceDir),
        ),
        scopedAgent.writeScope,
      );
      if (violations.length > 0) {
        const violationCtx = {
          stepId: step.id,
          agentName: scopedAgent.agentName,
          scope: scopedAgent.writeScope,
          violations,
        };
        writeWriteScopeViolationArtifact({
          ...violationCtx,
          metadata,
          projectDir: context.projectDir,
        });
        if (scopedAgent.writeScope === "deny-all") {
          repairPreSnapshot.restoreDenyAllMutations(
            workspaceDir,
            violations,
          );
        }
        throw new AgentWriteScopeViolationError(violationCtx);
      }
    }
    if (!repairAttempt.ok) {
      const failedIteration = repairAttempt.error instanceof RepairAgentIterationError
        ? repairAttempt.error
        : undefined;
      iteration.agentError = repairAttempt.error.message;
      if (failedIteration !== undefined) {
        recordRepairResult(iteration, failedIteration.result);
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
          failureOutput(),
        );
      }
      throw new RepairLoopError(
        undefined,
        step.id,
        failures.map((failure) => failure.id),
        failureOutput(),
        repairAttempt.error.message,
        agentBackoff,
      );
    }
    const repairResult = repairAttempt.result;
    recordRepairResult(iteration, repairResult);

    if (abortController.signal.aborted) break;

    await stageWorkflowChangesForRepairChecks(workspaceDir);
    const phased = await runChecksPhased(checks, context, step);
    failures = phased.failures;
    warnings = phased.warnings;

    if (failures.length > 0) {
      const progress = await repairProgressSnapshot(workspaceDir, failures);
      if (progress.key === previousProgress.key) {
        noProgressAttempts += 1;
      } else {
        previousProgress = progress;
        noProgressAttempts = 0;
      }
      if (noProgressAttempts >= REPAIR_NO_PROGRESS_LIMIT) {
        throw new RepairLoopError(
          "repair-no-progress",
          step.id,
          progress.failureIds,
          failureOutput(),
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
        failureOutput(),
        `Repair loop for step "${step.id}" exhausted repair attempts (${maxRepairAttempts}). ` +
          `Still failing: ${failures.map((f) => f.id).join(", ")}`,
      );
    }
  }

  return wrap({
    ...base,
    content: lastContent,
    turns: totalTurns,
    totalCostUsd,
    inputTokens,
    outputTokens,
    ...(logicalAttemptSessionId === undefined
      ? {}
      : { sessionId: logicalAttemptSessionId }),
    repairIterations: iterations,
    repairWarnings: warnings,
  });
}
