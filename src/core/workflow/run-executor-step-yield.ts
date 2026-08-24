import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import type { ActiveWorkflowRunHandle } from "./active-run-handle.js";
import {
  type ActiveTimeoutSnapshot,
  activeTimingMetadata,
} from "./active-timeout.js";
import { buildStepCompletedPayload, resolveStepAutonomyMode } from "./event-payloads.js";
import type { RepairLoopYield } from "./repair-loop-types.js";
import { writeFailedAgentTrajectoryDiagnostics } from "./run-executor-step-artifacts.js";
import {
  applyOutputSizeLimit,
  type StepAccumulators,
  type StepDeps,
} from "./run-executor-step-shared.js";
import type { WorkflowStepResult } from "./run-types.js";
import type { WorkflowStep } from "./step-types.js";
import type { AgentStepConfig } from "./steps/step-executor-agent.js";
import type { WorkflowDefinition } from "./types.js";

export function recordWorkflowStepYield(args: {
  signal: RepairLoopYield;
  definition: WorkflowDefinition;
  step: WorkflowStep;
  run: Pick<ActiveWorkflowRunHandle, "metadata" | "recordStep">;
  agentConfig: AgentStepConfig;
  acc: StepAccumulators;
  deps: StepDeps;
  stepStartedAt: number;
  timing: ActiveTimeoutSnapshot | undefined;
  capturedAgentMessages: readonly KotaAgentMessage[];
}): never {
  const limitedOutput = applyOutputSizeLimit(
    args.signal.output,
    args.agentConfig.config?.workflow?.maxStepOutputBytes,
  );
  if (limitedOutput.warning !== undefined) {
    args.acc.warnings.push(limitedOutput.warning);
    args.deps.log(
      `Yielded step "${args.step.id}" output truncated in workflow "${args.definition.name}": ${limitedOutput.warning.message}`,
    );
  }
  const trajectoryDiagnostics = writeFailedAgentTrajectoryDiagnostics({
    step: args.step,
    runDir: args.run.metadata.runDir,
    projectDir: args.agentConfig.projectDir,
    messages: args.capturedAgentMessages,
    log: args.deps.log,
  });
  const yielded: WorkflowStepResult = {
    id: args.step.id,
    type: args.step.type,
    status: "yielded",
    startedAt: new Date(args.stepStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - args.stepStartedAt,
    ...activeTimingMetadata(args.timing),
    costUsd: args.signal.output.totalCostUsd,
    inputTokens: args.signal.output.inputTokens,
    outputTokens: args.signal.output.outputTokens,
    output: limitedOutput.output,
    ...(trajectoryDiagnostics === undefined ? {} : { trajectoryDiagnostics }),
  };
  args.run.recordStep(yielded);
  args.acc.stepOutputsById[args.step.id] = limitedOutput.output;
  args.acc.stepResultsById[args.step.id] = yielded;
  args.acc.stepOutputs.push(limitedOutput.output);
  args.deps.pbus.emit(
    "workflow.step.completed",
    buildStepCompletedPayload(
      args.run.metadata,
      yielded,
      resolveStepAutonomyMode(args.step, args.definition.defaultAutonomyMode),
    ),
  );
  args.deps.log(
    `Yielded step "${args.step.id}" (${args.step.type}) in workflow "${args.definition.name}": ${args.signal.decision.summary}`,
  );
  throw args.signal;
}
