import {
  type AgentCanUseTool,
  type AgentTokenBudgetLedger,
  findRequiredHarnessReadinessFailures,
  formatRequiredHarnessReadinessFailures,
  type KotaAgentMessage,
  resolveAgentHarness,
  type TrajectoryDiagnosticsMetadata,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaConfig } from "#core/config/config.js";
import type { ApprovalQueue } from "#core/daemon/approval-queue.js";
import type { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import type { ResolvedScopePolicy } from "#core/daemon/scope-policy.js";
import type { DelegateBudget } from "#core/tools/delegate-budget.js";
import type { ToolResult } from "#core/tools/index.js";
import { ToolTelemetry } from "#core/tools/tool-telemetry.js";
import type {
  WorkflowRunMetadata,
  WorkflowRuntimeResources,
  WorkflowStepContext,
} from "../run-types.js";
import { WorkflowStepOutputValidationError } from "../step-input-code.js";
import type { WorkflowAgentStep } from "../step-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";
import type { AgentRunLimiter } from "./agent-run-limiter.js";
import {
  AgentWriteScopeViolationError,
  diffMutatedPaths,
  findWriteScopeViolations,
  listWorkflowMutatedPaths,
  removeWorkflowScratchArtifacts,
  tryListWorkflowMutatedPaths,
  writeWriteScopeViolationArtifact,
} from "./agent-write-scope.js";
import { runAgentAttempt } from "./step-executor-agent-attempt.js";
import { writeHarnessCapabilityArtifact } from "./step-executor-agent-capability.js";
import {
  JsonOutputValidationError,
} from "./step-executor-agent-json.js";
import {
  buildAgentPrompt,
  buildAgentSystemPrompt,
} from "./step-executor-agent-prompt.js";
import { writeToolTelemetryArtifact } from "./step-executor-agent-telemetry.js";
import {
  resolveAgentStepTokenBudget,
  writeAgentTokenBudgetArtifact,
} from "./step-executor-agent-token-budget.js";
import { writeAgentTrajectoryDiagnosticsArtifact } from "./step-executor-agent-trajectory-diagnostics.js";
import {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  DEFAULT_AGENT_STEP_RETRY,
  withRetry,
} from "./step-executor-retry.js";

export type WorkflowStepOutput =
  | ToolResult
  | { content: string; sessionId?: string; turns?: number; totalCostUsd?: number; inputTokens?: number; outputTokens?: number; subtype?: string }
  | Record<string, unknown>
  | string | number | boolean | null | undefined;
export type AgentStepResult = {
  output: WorkflowStepOutput;
  harness: string;
  model: string;
  trajectoryDiagnostics: TrajectoryDiagnosticsMetadata;
  trajectoryMessages: readonly KotaAgentMessage[];
  preStepMutatedPaths: readonly string[];
  tokenBudget?: AgentTokenBudgetLedger;
};

export type AgentStepConfig = {
  model?: string;
  config?: KotaConfig;
  projectDir: string;
  workspaceDir?: string;
  authorityConfigPath?: string;
  runtimeResources?: WorkflowRuntimeResources;
  log?: (message: string) => void;
  resolveAgentDef?: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt?: (skillNames: string[] | "all", agentName?: string) => string;
  createCanUseTool?: (stepId: string) => AgentCanUseTool;
  agentRunLimiter?: AgentRunLimiter;
  delegateBudget?: DelegateBudget;
  runTokenBudget?: AgentTokenBudgetLedger;
	approvalQueue?: ApprovalQueue;
  idempotencyStore?: IdempotencyStore;
  scopeId?: string;
  projectId?: string;
  scopePolicy?: ResolvedScopePolicy;
};
export { resolvePromptContextStartDir } from "./step-executor-agent-prompt.js";
export {
  AgentStepRuntimeError,
  classifyAgentRuntimeFailure,
  DEFAULT_AGENT_STEP_RETRY,
  withRetry,
};

export function resolveAgentModel(step: WorkflowAgentStep, agentConfig: AgentStepConfig): string {
  return (step.agentName ? agentConfig.config?.agentModels?.[step.agentName] : undefined) ?? step.model;
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
    const preStepMutatedPaths = scopedAgent
      ? listWorkflowMutatedPaths(workspaceDir)
      : (tryListWorkflowMutatedPaths(workspaceDir) ?? []);
    let output: WorkflowStepOutput;
    try {
      output = await runWithRetry();
    } finally {
      writeAgentTokenBudgetArtifact(
        step.id,
        metadata,
        agentConfig.projectDir,
        tokenBudget,
      );
      removeWorkflowScratchArtifacts(workspaceDir);
    }

    if (bufferAgentMessages) {
      for (const message of successfulAttemptMessages) appendMessage(message);
    }

    if (resolvedHarness.emitsAgentMessageStream) {
      writeToolTelemetryArtifact(step.id, metadata, agentConfig.projectDir, stepTelemetry);
    }

    const postStepMutatedPaths = scopedAgent
      ? listWorkflowMutatedPaths(workspaceDir)
      : (tryListWorkflowMutatedPaths(workspaceDir) ?? []);
    const stepMutatedPaths = diffMutatedPaths(preStepMutatedPaths, postStepMutatedPaths);
    const trajectoryDiagnostics = writeAgentTrajectoryDiagnosticsArtifact({
      stepId: step.id,
      runDir: metadata.runDir,
      projectDir: agentConfig.projectDir,
      harness: resolvedHarness,
      messages: successfulAttemptMessages,
      changedFiles: stepMutatedPaths,
    });

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
        throw new AgentWriteScopeViolationError(violationCtx);
      }
    }

    return {
      output,
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
