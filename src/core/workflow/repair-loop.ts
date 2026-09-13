import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import { AgentBackoffAdmissionError } from "./agent-backoff.js";
import {
  agentRunDirWriteScopes,
  resolveAgentRunDir,
} from "./agent-run-dir.js";
import {
  assertContinuationDecision,
  continuationPacketNeedsJudgment,
  createContinuationPacket,
  type WorkflowContinuationContext,
  type WorkflowContinuationDecision,
  type WorkflowContinuationPacket,
  type WorkflowContinuationRecord,
  type WorkflowContinuationRepairEvidence,
} from "./continuation.js";
import {
  executeRepairAgentIteration,
  RepairAgentIterationError,
  type RepairAgentIterationResult,
} from "./repair-loop-agent-iteration.js";
import {
  type RepairCheckResult,
  runChecksPhased,
} from "./repair-loop-checks.js";
import { repairProgressSnapshot } from "./repair-loop-progress.js";
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
  WorkflowContinuationSuspension,
} from "./repair-loop-types.js";
import { enforceRepairAgentWriteScope } from "./repair-loop-write-scope.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepContext,
} from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import { requiresWriteScopeSnapshot } from "./steps/agent-write-scope.js";
import { captureWorkflowMutationSnapshot } from "./steps/agent-write-scope-snapshot.js";
import type { AgentStepConfig, AgentStepResult } from "./steps/step-executor-agent.js";
import { writeAgentTokenBudgetArtifact } from "./steps/step-executor-agent-token-budget.js";
import {
  AgentStepRuntimeError,
  classifyThrownAgentError,
  isEmptyAgentOutputSubtype,
} from "./steps/step-executor-retry.js";

export type { RepairCheckResult } from "./repair-loop-checks.js";
export { buildRepairPrompt } from "./repair-loop-prompt.js";
export {
  RepairAgentRuntimeError,
  type RepairIteration,
  RepairLoopError,
  type RepairLoopFailureOutput,
  WorkflowContinuationSuspension,
} from "./repair-loop-types.js";

const REPAIR_NO_PROGRESS_LIMIT = 3;

export type AgentContinuationPolicy = Readonly<{
  collectContext: (
    context: WorkflowStepContext,
    parentStep: WorkflowAgentStep,
  ) => Promise<WorkflowContinuationContext> | WorkflowContinuationContext;
  decide: (
    context: WorkflowStepContext,
    parentStep: WorkflowAgentStep,
    packet: WorkflowContinuationPacket,
  ) => Promise<WorkflowContinuationDecision> | WorkflowContinuationDecision;
}>;

export async function evaluateAgentContinuation(input: {
  policy: AgentContinuationPolicy;
  step: WorkflowAgentStep;
  context: WorkflowStepContext;
  metadata: WorkflowRunMetadata;
  initialWorkspace: WorkflowContinuationRepairEvidence;
  trajectory: readonly WorkflowContinuationRepairEvidence[];
  currentWorkspace: {
    fingerprint: string;
    changedPaths: readonly string[];
    diffStat: string;
    diff: string;
  };
  remainingFailures: readonly Readonly<{ id: string; output: string }>[];
}): Promise<WorkflowContinuationRecord | null> {
  const packet = await prepareAgentContinuationPacket(input);
  if (packet === null) return null;
  const existing = input.metadata.continuations ?? [];
  if (!continuationPacketNeedsJudgment(existing, input.step.id, packet)) {
    return null;
  }
  let decision: WorkflowContinuationDecision;
  try {
    decision = assertContinuationDecision(
      await input.policy.decide(input.context, input.step, packet),
    );
  } catch (error) {
    if (
      error instanceof AgentStepRuntimeError ||
      error instanceof AgentBackoffAdmissionError ||
      (error instanceof Error && error.name === "AbortError")
    ) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    const classification = classifyThrownAgentError(error);
    throw new AgentStepRuntimeError(
      `Continuation judgment failed at a quiescent checkpoint: ${detail}`,
      classification?.kind ?? "runtime",
      false,
      classification?.retryAt,
    );
  }
  const record: WorkflowContinuationRecord = Object.freeze({
    stepId: input.step.id,
    decidedAt: new Date().toISOString(),
    packet,
    decision,
  });
  return record;
}

export async function prepareAgentContinuationPacket(input: {
  policy: AgentContinuationPolicy;
  step: WorkflowAgentStep;
  context: WorkflowStepContext;
  continuationContext?: WorkflowContinuationContext;
  initialWorkspace: WorkflowContinuationRepairEvidence;
  trajectory: readonly WorkflowContinuationRepairEvidence[];
  currentWorkspace: {
    fingerprint: string;
    changedPaths: readonly string[];
    diffStat: string;
    diff: string;
  };
  remainingFailures: readonly Readonly<{ id: string; output: string }>[];
}): Promise<WorkflowContinuationPacket | null> {
  const continuationContext = input.continuationContext ??
    await input.policy.collectContext(input.context, input.step);
  const packet = createContinuationPacket({
    context: continuationContext,
    initialWorkspace: input.initialWorkspace,
    trajectory: input.trajectory,
    currentWorkspace: input.currentWorkspace,
    remainingFailures: input.remainingFailures,
  });
  return packet;
}

export async function runAgentRepairLoop(
  step: WorkflowAgentStep,
  initialResult: AgentStepResult,
  context: WorkflowStepContext,
  metadata: WorkflowRunMetadata,
  abortController: AbortController,
  appendMessage: (message: KotaAgentMessage) => void,
  agentConfig: AgentStepConfig,
  recordContinuation: (record: WorkflowContinuationRecord) => void = (record) => {
    metadata.continuations = [...(metadata.continuations ?? []), record];
  },
): Promise<AgentStepResult> {
  const { checks, maxRepairAttempts } = step.repairLoop!;
  const iterations: RepairIteration[] = [];
  const base = (initialResult.output && typeof initialResult.output === "object") ? initialResult.output as Record<string, unknown> : {};
  let totalTurns = typeof base.turns === "number" ? base.turns : 0;
  let logicalAttemptSessionId = typeof base.sessionId === "string"
    ? base.sessionId
    : undefined;
  let lastContent = typeof base.content === "string" ? base.content : "";
  const initialSubtype = typeof base.subtype === "string" ? base.subtype : undefined;
  let warnings = [] as RepairCheckResult[];
  const continuationDecisions: WorkflowContinuationRecord[] = [
    ...(metadata.continuations ?? []),
  ];
  const trajectoryMessages = [...initialResult.trajectoryMessages];
  const resolvedHarness = agentConfig.resolveAgentHarness?.(step.harness);
  if (resolvedHarness === undefined) {
    throw new Error(`Agent repair loop has no harness resolver for "${step.harness}"`);
  }
  const scopedAgent = resolveScopedRepairAgent(step, agentConfig);
  const workspaceDir = context.workspaceRoot;
  const agentRunDir = resolveAgentRunDir({
    metadata,
    scopeRoot: context.scopeRoot,
    runtimeResources: context.runtimeResources,
  });
  const agentOutputWriteScopes = agentRunDirWriteScopes(
    workspaceDir,
    agentRunDir,
  );
  const failureOutput = (): RepairLoopFailureOutput => ({
    content: lastContent,
    turns: totalTurns,
    ...(logicalAttemptSessionId === undefined
      ? {}
      : { sessionId: logicalAttemptSessionId }),
    repairIterations: iterations,
    repairWarnings: warnings,
    ...(continuationDecisions.length === 0
      ? {}
      : { continuationDecisions }),
  });
  const recordRepairResult = (
    iteration: RepairIteration,
    result: RepairAgentIterationResult,
  ): void => {
    iteration.agentResponse = result.text;
    iteration.agentTurns = result.turns;
    iteration.agentSessionId = result.sessionId;
    iteration.agentSubtype = result.subtype;
    iterations.push(iteration);

    lastContent = result.text;
    totalTurns += result.turns ?? 0;
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
      repairIterations: iterations,
      repairWarnings: warnings,
      ...(continuationDecisions.length === 0
        ? {}
        : { continuationDecisions }),
    });
  }

  const {
    failures: initialFailures,
    warnings: initialWarnings,
  } = await runChecksPhased(checks, context, step);
  let failures = initialFailures;
  warnings = initialWarnings;
  let previousProgress = await repairProgressSnapshot(
    workspaceDir,
    failures,
    context.runCommand,
  );
  const initialWorkspace: WorkflowContinuationRepairEvidence =
    initialResult.continuationInitialWorkspace ?? {
      attempt: 0,
      source: "active",
      verificationResults: [],
      workspaceFingerprint: previousProgress.key,
      changedPaths: previousProgress.changedPaths,
    };
  const repairEvidence: WorkflowContinuationRepairEvidence[] = [
    ...(initialResult.continuationTrajectory ?? []),
  ];
  const evaluateContinuation = async (
    progress: Awaited<ReturnType<typeof repairProgressSnapshot>>,
  ): Promise<void> => {
    const policy = step.repairLoop?.continuation;
    if (policy === undefined) return;
    const record = await evaluateAgentContinuation({
      policy,
      step,
      context,
      metadata,
      initialWorkspace,
      trajectory: repairEvidence,
      currentWorkspace: {
        fingerprint: progress.key,
        changedPaths: progress.changedPaths,
        diffStat: progress.diffStat,
        diff: progress.diff,
      },
      remainingFailures: failures.map((failure) => ({
        id: failure.id,
        output: failure.output,
      })),
    }).catch((error: unknown) => {
      if (error instanceof AgentBackoffAdmissionError) {
        throw new RepairLoopError(
          undefined, step.id, progress.failureIds, failureOutput(),
          error.message, error,
        );
      }
      if (error instanceof AgentStepRuntimeError) {
        throw new RepairAgentRuntimeError(
          error, step.id, progress.failureIds, failureOutput(),
        );
      }
      throw error;
    });
    if (record === null) return;
    try {
      recordContinuation(record);
    } catch (error) {
      const suspension = new WorkflowContinuationSuspension(
        record,
        step.id,
        progress.failureIds,
        failureOutput(),
      );
      suspension.recordCheckpointFailure(
        "continuation decision persistence failed",
        error,
      );
      throw suspension;
    }
    continuationDecisions.push(record);
    if (record.decision.decision !== "continue") {
      throw new WorkflowContinuationSuspension(
        record,
        step.id,
        progress.failureIds,
        failureOutput(),
      );
    }
  };
  let noProgressAttempts = 0;

  if (failures.length > 0) {
    await evaluateContinuation(previousProgress);
  }

  for (let attempt = 1; failures.length > 0 && (maxRepairAttempts === undefined || attempt <= maxRepairAttempts); attempt++) {
    if (abortController.signal.aborted) break;

    const iteration: RepairIteration = { attempt, failures };

    const repairPrompt = buildRepairPrompt(
      attempt,
      maxRepairAttempts,
      failures,
      step,
      agentRunDir,
      resolvedHarness.toolControl !== "native",
    );
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
        context.scopeRoot,
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
        scopeRoot: context.scopeRoot,
      });
    }
    if (!repairAttempt.ok) {
      if (repairAttempt.error instanceof AgentBackoffAdmissionError) {
        throw repairAttempt.error;
      }
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

    const phased = await runChecksPhased(checks, context, step);
    failures = phased.failures;
    warnings = phased.warnings;

    if (failures.length > 0) {
      const progress = await repairProgressSnapshot(
        workspaceDir,
        failures,
        context.runCommand,
      );
      repairEvidence.push({
        attempt,
        source: "repair",
        verificationResults: phased.results.map((result) => ({
          id: result.id,
          passed: result.passed,
          output: result.output,
        })),
        workspaceFingerprint: progress.key,
        changedPaths: progress.changedPaths,
      });

      await evaluateContinuation(progress);
      const madeNoProgress = progress.key === previousProgress.key;
      if (madeNoProgress) {
        noProgressAttempts += 1;
      } else {
        previousProgress = progress;
        noProgressAttempts = 0;
      }
      const emptyOutputCount = Number(isEmptyAgentOutputSubtype(initialSubtype)) +
        iterations.filter((entry) =>
          isEmptyAgentOutputSubtype(entry.agentSubtype) &&
          (entry.agentResponse ?? "").trim().length === 0
        ).length;
      if (emptyOutputCount >= 2 && madeNoProgress) {
        throw new RepairAgentRuntimeError(
          new AgentStepRuntimeError(
            `Agent step "${step.id}" produced ${emptyOutputCount} successful terminal results without usable output or repair progress`,
            "output_contract",
            false,
            undefined,
            logicalAttemptSessionId,
          ),
          step.id,
          progress.failureIds,
          failureOutput(),
        );
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
    ...(logicalAttemptSessionId === undefined
      ? {}
      : { sessionId: logicalAttemptSessionId }),
    repairIterations: iterations,
    repairWarnings: warnings,
    ...(continuationDecisions.length === 0
      ? {}
      : { continuationDecisions }),
  });
}
