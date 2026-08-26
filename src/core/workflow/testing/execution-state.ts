import { join } from "node:path";
import type {
  ScopePolicySnapshot,
} from "#core/daemon/scope-policy.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import type {
  WorkflowBlockingOperation,
  WorkflowBlockingOperationHandler,
} from "#core/workflow/blocking-operation.js";
import type {
  TransactionalRunState,
} from "#core/workflow/run-context.js";
import type {
  WorkflowRuntimeResources,
  WorkflowRuntimeState,
  WorkflowStepContext,
  WorkflowStepResult,
  WorkflowStepSkipReason,
} from "#core/workflow/run-types.js";
import type { WorkflowCodeStepContext } from "#core/workflow/step-input-code.js";
import type { WorkflowStepInput } from "#core/workflow/step-input-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import { unexpectedWorkflowAgentHarnessRun } from "./agent-harness-runner.js";
import type {
  HarnessObjectValue,
  HarnessOptions,
  HarnessOutputValue,
  HarnessRunResult,
  HarnessStepResult,
} from "./index.js";
import {
  BRANCH_ARM_NOT_TAKEN,
  makeStepResult,
} from "./results.js";
import { createTestTransactionalRunState } from "./run-context-fixture.js";

async function runBlockingOperationInProcess<TInput, TOutput>(
  operation: WorkflowBlockingOperation<TInput, TOutput>,
  input: TInput,
): Promise<TOutput> {
  const module: {
    [exportName: string]: WorkflowBlockingOperationHandler<TInput, TOutput>;
  } = await import(operation.moduleUrl);
  const handler = module[operation.exportName];
  if (typeof handler !== "function") {
    throw new Error(
      `Workflow blocking operation export "${operation.exportName}" is not a function`,
    );
  }
  return handler(input, {
    signal: new AbortController().signal,
    reportProgress: () => {},
  });
}

type HarnessRuntimeTrigger = {
  event: string;
  schemaRef: WorkflowRunTrigger["schemaRef"];
  payload: HarnessObjectValue;
};

type HarnessExecutionInput = {
  projectDir: string;
  workspaceDir: string;
  runtimeResources?: WorkflowRuntimeResources;
  trigger: HarnessRuntimeTrigger;
};

type BuildContextOverrides = {
  foreach?: WorkflowStepContext["foreach"];
  stepOutputs?: Record<string, HarnessOutputValue>;
  stepOutputList?: HarnessOutputValue[];
};

export class HarnessExecutionState {
  readonly workflow: WorkflowDefinitionInput;
  readonly options: HarnessOptions;
  readonly projectDir: string;
  readonly trigger: HarnessRuntimeTrigger;
  readonly stepMocks: NonNullable<HarnessOptions["stepMocks"]>;
  readonly runParallel: boolean;
  readonly emitted: HarnessRunResult["emitted"] = [];
  readonly stepOutputsById: Record<string, HarnessOutputValue> = {};
  readonly stepResultsById: Record<string, WorkflowStepResult> = {};
  readonly stepOutputList: HarnessOutputValue[] = [];
  readonly allStepResults: Record<string, HarnessStepResult> = {};
  readonly transactionalState: TransactionalRunState;

  workspaceDir: string;
  runtimeResources: WorkflowRuntimeResources | undefined;
  scopePolicySnapshot: ScopePolicySnapshot | undefined;
  restartRequested: string | undefined;
  runFailed = false;
  runError: string | undefined;

  constructor(
    workflow: WorkflowDefinitionInput,
    options: HarnessOptions,
    input: HarnessExecutionInput,
  ) {
    this.workflow = workflow;
    this.options = options;
    this.projectDir = input.projectDir;
    this.workspaceDir = input.workspaceDir;
    this.runtimeResources = input.runtimeResources;
    this.scopePolicySnapshot = options.scopePolicySnapshot;
    this.trigger = input.trigger;
    this.stepMocks = options.stepMocks ?? {};
    this.runParallel = options.parallel ?? false;
    this.transactionalState =
      options.contextOverrides?.state ?? createTestTransactionalRunState();
  }

  buildContext(overrides: BuildContextOverrides = {}): WorkflowCodeStepContext {
    const previousOutput =
      this.stepOutputList.length > 0
        ? this.stepOutputList[this.stepOutputList.length - 1]
        : undefined;
    const runtimeState: WorkflowRuntimeState = {
      completedRuns: this.options.runtimeState?.completedRuns ?? 0,
      workflows: this.options.runtimeState?.workflows ?? {},
    };

    return {
      projectDir: this.workspaceDir,
      scopeDir: this.projectDir,
      stateDir: join(this.projectDir, ".kota"),
      state: this.transactionalState,
      agentRuntime: resolveAgentRuntime(undefined),
      ...(this.runtimeResources !== undefined
        ? { runtimeResources: this.runtimeResources }
        : {}),
      ...(this.scopePolicySnapshot !== undefined
        ? { scopePolicySnapshot: this.scopePolicySnapshot }
        : {}),
      workflow: {
        name: this.workflow.name,
        definitionPath: "test",
        runId: "harness-run-id",
        runDir: ".kota/runs/harness",
        runDirPath: `${this.projectDir}/.kota/runs/harness`,
      },
      trigger: this.trigger,
      previousOutput,
      stepOutputs: overrides.stepOutputs ?? { ...this.stepOutputsById },
      stepResults: { ...this.stepResultsById },
      stepOutputList: overrides.stepOutputList ?? [...this.stepOutputList],
      ...(overrides.foreach !== undefined ? { foreach: overrides.foreach } : {}),
      runAgentHarness: unexpectedWorkflowAgentHarnessRun,
      runCommand:
        this.options.contextOverrides?.runCommand ??
        createWorkflowCommandRunner({
          cwd: this.workspaceDir,
          ...(this.runtimeResources !== undefined
            ? { env: this.runtimeResources.env }
            : {}),
        }),
      runTool:
        this.options.contextOverrides?.runTool ??
        (() => {
          throw new Error(
            "runTool called but no contextOverrides.runTool mock was provided",
          );
        }),
      emit: (event, payload) =>
        this.emitted.push({ event, schemaRef: null, payload }),
      requestRestart: (reason) => {
        this.restartRequested = reason;
      },
      readPrompt: this.options.contextOverrides?.readPrompt ?? (() => ""),
      readRuntimeState: () => runtimeState,
      reportProgress: () => {},
      runBlocking:
        this.options.contextOverrides?.runBlocking ??
        ((operation, input) => runBlockingOperationInProcess(operation, input)),
      triggerWorkflow:
        this.options.contextOverrides?.triggerWorkflow ??
        (() => {
          throw new Error(
            "triggerWorkflow called but no contextOverrides.triggerWorkflow mock was provided",
          );
        }),
    };
  }

  recordResult(
    harness: HarnessStepResult,
    internal: WorkflowStepResult,
    output: HarnessOutputValue,
  ): void {
    this.allStepResults[harness.id] = harness;
    this.stepResultsById[harness.id] = internal;
    if (output !== undefined) {
      this.stepOutputsById[harness.id] = output;
      this.stepOutputList.push(output);
    }
  }

  recordSkippedArm(steps: WorkflowStepInput[]): void {
    for (const step of steps) {
      const { harness, internal } = makeStepResult(
        step.id,
        step.type,
        "skipped",
        undefined,
        undefined,
        BRANCH_ARM_NOT_TAKEN,
      );
      this.allStepResults[step.id] = harness;
      this.stepResultsById[step.id] = internal;
      if (step.type === "branch") {
        this.recordSkippedArm(step.ifTrue);
        if (step.ifFalse) this.recordSkippedArm(step.ifFalse);
      } else if (step.type === "parallel" || step.type === "foreach") {
        this.recordSkippedArm(step.steps);
      }
    }
  }

  recordSkippedChildren(
    steps: WorkflowStepInput[],
    reason: WorkflowStepSkipReason,
  ): void {
    for (const step of steps) {
      const { harness, internal } = makeStepResult(
        step.id,
        step.type,
        "skipped",
        undefined,
        undefined,
        reason,
      );
      this.allStepResults[step.id] = harness;
      this.stepResultsById[step.id] = internal;
      if (step.type === "branch") {
        this.recordSkippedChildren(step.ifTrue, reason);
        if (step.ifFalse) this.recordSkippedChildren(step.ifFalse, reason);
      } else if (step.type === "parallel" || step.type === "foreach") {
        this.recordSkippedChildren(step.steps, reason);
      }
    }
  }

  markFailed(error: string): void {
    this.runFailed = true;
    this.runError = error;
  }

  toRunResult(): HarnessRunResult {
    return {
      status: this.runFailed ? "failed" : "success",
      steps: this.allStepResults,
      ...(this.runError !== undefined ? { error: this.runError } : {}),
      emitted: this.emitted,
      ...(this.restartRequested !== undefined
        ? { restartRequested: this.restartRequested }
        : {}),
    };
  }
}
