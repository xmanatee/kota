import {
  findRequiredHarnessReadinessFailures,
  formatRequiredHarnessReadinessFailures,
  type KotaAgentMessage,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import { ToolTelemetry } from "#core/tools/tool-telemetry.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepContext,
} from "../run-types.js";
import { WorkflowStepOutputValidationError } from "../step-input-code.js";
import type { WorkflowAgentStep } from "../step-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";
import {
  AgentWriteScopeViolationError,
  diffMutatedPaths,
  findWriteScopeViolations,
  removeWorkflowScratchArtifacts,
  requiresWriteScopeSnapshot,
  tryListWorkflowMutatedPaths,
  writeWriteScopeViolationArtifact,
} from "./agent-write-scope.js";
import { captureWorkflowMutationSnapshot } from "./agent-write-scope-snapshot.js";
import { runAgentAttempt } from "./step-executor-agent-attempt.js";
import { writeHarnessCapabilityArtifact } from "./step-executor-agent-capability.js";
import {
  JsonOutputValidationError,
} from "./step-executor-agent-json.js";
import {
  buildAgentPrompt,
  buildAgentSystemPrompt,
} from "./step-executor-agent-prompt.js";
import { resolveWorkflowAgentModel } from "./step-executor-agent-run-contract.js";
import { writeToolTelemetryArtifact } from "./step-executor-agent-telemetry.js";
import {
  resolveAgentStepTokenBudget,
  writeAgentTokenBudgetArtifact,
} from "./step-executor-agent-token-budget.js";
import { writeAgentTrajectoryDiagnosticsArtifact } from "./step-executor-agent-trajectory-diagnostics.js";
import type {
  AgentStepConfig,
  AgentStepResult,
  WorkflowStepOutput,
} from "./step-executor-agent-types.js";
import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  DEFAULT_AGENT_STEP_RETRY,
  withRetry,
} from "./step-executor-retry.js";

export { resolvePromptContextStartDir } from "./step-executor-agent-prompt.js";
export type {
  AgentStepConfig,
  AgentStepResult,
  WorkflowStepOutput,
} from "./step-executor-agent-types.js";
export {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  DEFAULT_AGENT_STEP_RETRY,
  withRetry,
};

export function resolveAgentModel(step: WorkflowAgentStep, agentConfig: AgentStepConfig): string {
  return resolveWorkflowAgentModel(step, agentConfig.config?.agentModels);
}

export async function executeAgentStep(
  definition: WorkflowDefinition,
  step: WorkflowAgentStep,
  metadata: WorkflowRunMetadata,
  trigger: WorkflowRunTrigger,
  abortController: AbortController,
  appendMessage: (message: KotaAgentMessage) => void,
  writeInputs: (systemPromptAppend: string | undefined, prompt: string) => void,
  agentConfig: AgentStepConfig,
  priorStepOutputs: Record<string, unknown> = {},
  foreach?: WorkflowStepContext["foreach"],
): Promise<AgentStepResult> {
  const resolvedHarness = resolveAgentHarness(step.harness);
  const resolvedModel = resolveAgentModel(step, agentConfig);
  const workspaceDir = agentConfig.workspaceDir ?? agentConfig.projectDir;
  const capabilitySnapshot = writeHarnessCapabilityArtifact(
    step.id,
    metadata,
    agentConfig.projectDir,
    resolvedHarness,
  );
  const readinessFailures =
    findRequiredHarnessReadinessFailures(capabilitySnapshot);
  if (readinessFailures.length > 0) {
    throw new AgentStepRuntimeError(
      `Agent step "${step.id}" failed (harness_readiness): ${formatRequiredHarnessReadinessFailures(
        resolvedHarness.name,
        readinessFailures,
      )}`,
      "auth",
      false,
    );
  }

  const agentDef = step.agentName && agentConfig.resolveAgentDef
    ? agentConfig.resolveAgentDef(step.agentName)
    : undefined;
  const scopedAgent = agentDef && step.agentName
    ? { agentName: step.agentName, writeScope: agentDef.writeScope }
    : undefined;
  const agentPrompt = buildAgentPrompt(
    definition,
    step,
    metadata,
    trigger,
    agentConfig.projectDir,
    priorStepOutputs,
    resolvedHarness.askOwnerToolName,
    foreach,
    scopedAgent?.writeScope,
    agentConfig.runtimeResources,
  );
  const systemPrompt = buildAgentSystemPrompt({
    config: agentConfig.config,
    systemPromptAppend: agentPrompt.systemPromptAppend,
    moduleRoot: step.moduleRoot,
    promptPath: step.promptPath,
    projectDir: agentConfig.projectDir,
    agentDef,
    agentName: step.agentName,
    resolveSkillsPrompt: agentConfig.resolveSkillsPrompt,
  });
  writeInputs(systemPrompt, agentPrompt.prompt);

  const stepTelemetry = new ToolTelemetry();

  const bufferAgentMessages = step.validate !== undefined;
  let successfulAttemptMessages: KotaAgentMessage[] = [];
  let lastJsonOutputFeedback: string | undefined;
  const tokenBudget = resolveAgentStepTokenBudget(
    step,
    agentConfig.runTokenBudget,
    agentConfig.config,
  );

  const runAttempt = (): Promise<WorkflowStepOutput> =>
    runAgentAttempt({
      step,
      metadata,
      agentConfig,
      resolvedHarness,
      resolvedModel,
      prompt: agentPrompt.prompt,
      jsonOutputFeedback: lastJsonOutputFeedback,
      systemPrompt,
      abortController,
      appendMessage,
      bufferAgentMessages,
      stepTelemetry,
      tokenBudget,
      onSuccessfulAttemptMessages: (messages) => {
        successfulAttemptMessages = messages;
      },
      onJsonOutputFeedback: (feedback) => {
        lastJsonOutputFeedback = feedback;
      },
    });

  const retry = step.retry ?? DEFAULT_AGENT_STEP_RETRY;
  const runWithRetry = () => withRetry(runAttempt, retry, {
    log: agentConfig.log,
    abortSignal: abortController.signal,
    // Retry only classified transients and structured-output correction paths.
    shouldRetry: (err) =>
      err instanceof JsonOutputValidationError ||
      (step.outputFormat === "json" && err instanceof WorkflowStepOutputValidationError) ||
      (err instanceof AgentStepRuntimeError && err.retryable),
  });

  const executeWithWorkspaceAttribution = async (): Promise<AgentStepResult> => {
    // Snapshot after the workspace lane so wait time is not attribution time.
    const preStepSnapshot =
      scopedAgent && requiresWriteScopeSnapshot(scopedAgent.writeScope)
        ? captureWorkflowMutationSnapshot(workspaceDir)
        : undefined;
    const preStepMutatedPaths = preStepSnapshot?.mutatedPaths ??
      (tryListWorkflowMutatedPaths(workspaceDir) ?? []);
    let attempt:
      | { ok: true; output: WorkflowStepOutput }
      | { ok: false; error: Error };
    try {
      attempt = { ok: true, output: await runWithRetry() };
    } catch (error) {
      attempt = {
        ok: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } finally {
      writeAgentTokenBudgetArtifact(
        step.id,
        metadata,
        agentConfig.projectDir,
        tokenBudget,
      );
      removeWorkflowScratchArtifacts(workspaceDir);
    }

    if (attempt.ok && bufferAgentMessages) {
      for (const message of successfulAttemptMessages) appendMessage(message);
    }

    if (resolvedHarness.emitsAgentMessageStream) {
      writeToolTelemetryArtifact(step.id, metadata, agentConfig.projectDir, stepTelemetry);
    }

    const stepMutatedPaths = preStepSnapshot
      ? preStepSnapshot.changedPathsSince(
          captureWorkflowMutationSnapshot(workspaceDir),
        )
      : diffMutatedPaths(
          preStepMutatedPaths,
          tryListWorkflowMutatedPaths(workspaceDir) ?? [],
        );
    // Whole-step writeScope contract: pre/post diff inside the workspace lane.
    if (scopedAgent) {
      const violations = findWriteScopeViolations(
        stepMutatedPaths,
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
          projectDir: agentConfig.projectDir,
        });
        if (scopedAgent.writeScope === "deny-all") {
          preStepSnapshot?.restoreDenyAllMutations(workspaceDir, violations);
        }
        throw new AgentWriteScopeViolationError(violationCtx);
      }
    }

    if (!attempt.ok) throw attempt.error;

    const trajectoryDiagnostics = writeAgentTrajectoryDiagnosticsArtifact({
      stepId: step.id,
      runDir: metadata.runDir,
      projectDir: agentConfig.projectDir,
      harness: resolvedHarness,
      messages: successfulAttemptMessages,
      changedFiles: stepMutatedPaths,
    });

    return {
      output: attempt.output,
      harness: resolvedHarness.name,
      model: resolvedModel,
      trajectoryDiagnostics,
      trajectoryMessages: successfulAttemptMessages,
      preStepMutatedPaths,
      ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    };
  };

  if (!agentConfig.agentRunLimiter) {
    return await executeWithWorkspaceAttribution();
  }
  return scopedAgent
    ? await agentConfig.agentRunLimiter.runExclusive(
        workspaceDir,
        executeWithWorkspaceAttribution,
        abortController.signal,
      )
    : await agentConfig.agentRunLimiter.run(
        executeWithWorkspaceAttribution,
        abortController.signal,
      );
}
