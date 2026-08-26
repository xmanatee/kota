import type {
  AgentHarness,
  KotaAgentMessage,
} from "#core/agent-harness/types.js";
import type { ScopedRepairAgent } from "./repair-loop-types.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import {
  AgentWriteScopeViolationError,
  diffMutatedPaths,
  findWriteScopeViolations,
  listWorkflowMutatedPaths,
  tryListWorkflowMutatedPaths,
  writeWriteScopeViolationArtifact,
} from "./steps/agent-write-scope.js";
import type {
  AgentStepConfig,
  AgentStepResult,
} from "./steps/step-executor-agent.js";
import { writeAgentTrajectoryDiagnosticsArtifact } from "./steps/step-executor-agent-trajectory-diagnostics.js";

export function resolveScopedRepairAgent(
  step: WorkflowAgentStep,
  agentConfig: AgentStepConfig,
): ScopedRepairAgent | undefined {
  if (!step.agentName || !agentConfig.resolveAgentDef) return undefined;
  const agentDef = agentConfig.resolveAgentDef(step.agentName);
  if (!agentDef) return undefined;
  return {
    agentName: step.agentName,
    writeScope: agentDef.writeScope,
  };
}

export function createRepairLoopResultWrapper(options: {
  step: WorkflowAgentStep;
  initialResult: AgentStepResult;
  context: WorkflowStepContext;
  metadata: WorkflowRunMetadata;
  resolvedHarness: AgentHarness;
  trajectoryMessages: KotaAgentMessage[];
  scopedAgent: ScopedRepairAgent | undefined;
  workspaceDir: string;
}): (output: AgentStepResult["output"]) => AgentStepResult {
  return (output) => {
    const postStepMutatedPaths = options.scopedAgent
      ? listWorkflowMutatedPaths(options.workspaceDir)
      : (tryListWorkflowMutatedPaths(options.workspaceDir) ?? []);
    const changedFiles = diffMutatedPaths(
      options.initialResult.preStepMutatedPaths,
      postStepMutatedPaths,
    );
    const trajectoryDiagnostics = writeAgentTrajectoryDiagnosticsArtifact({
      stepId: options.step.id,
      runDir: options.context.workflow.runDir,
      scopeRoot: options.context.scopeRoot,
      harness: options.resolvedHarness,
      messages: options.trajectoryMessages,
      changedFiles,
    });
    if (options.scopedAgent) {
      const violations = findWriteScopeViolations(
        changedFiles,
        options.scopedAgent.writeScope,
      );
      if (violations.length > 0) {
        const violationCtx = {
          stepId: options.step.id,
          agentName: options.scopedAgent.agentName,
          scope: options.scopedAgent.writeScope,
          violations,
        };
        writeWriteScopeViolationArtifact({
          ...violationCtx,
          metadata: options.metadata,
          scopeRoot: options.context.scopeRoot,
        });
        throw new AgentWriteScopeViolationError(violationCtx);
      }
    }
    return {
      output,
      harness: options.initialResult.harness,
      model: options.initialResult.model,
      trajectoryDiagnostics,
      trajectoryMessages: options.trajectoryMessages,
      preStepMutatedPaths: options.initialResult.preStepMutatedPaths,
    };
  };
}
