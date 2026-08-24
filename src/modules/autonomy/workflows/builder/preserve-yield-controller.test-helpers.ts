import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import {
  runWorkflowBlockingOperation,
  type WorkflowBlockingOperationRunner,
} from "#core/workflow/blocking-operation.js";
import type {
  WorkflowRepairContinuationDecision,
  WorkflowRunMetadata,
  WorkflowStepContext,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import { builderContinuationController } from "./continuation-controller.js";
import {
  fixtureGit,
  PRESERVED_RUN_ID,
  PRESERVED_TASK_ID,
} from "./preserve-yield-lifecycle.test-helpers.js";

export async function evaluatePreserveYieldThroughController(input: {
  projectDir: string;
  workspaceDir: string;
  branch: string;
  baseCommit: string;
}): Promise<WorkflowRepairContinuationDecision> {
  const harnessName = `preserve-yield-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  registerAgentHarness({
    name: harnessName,
    description: "preserve-yield lifecycle judge harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    run: async () => ({
      text: "unused",
      streamedText: "unused",
      turns: 1,
      isError: false,
    }),
  });
  const runDirPath = join(input.projectDir, ".kota/runs", PRESERVED_RUN_ID);
  mkdirSync(runDirPath, { recursive: true });
  const response = JSON.stringify({
    decision: "preserve-yield",
    summary: "Useful work is durable and the P0 Safety task outranks it.",
    nextAction: "Resume the same task lineage after the P0 Safety task completes.",
    evidence: [
      "boundaryReasons contains the P0 Safety frontier",
      "context.diff records useful uncommitted work",
    ],
  });
  const runBlocking: WorkflowBlockingOperationRunner["runBlocking"] = (
    operation,
    operationInput,
  ) => runWorkflowBlockingOperation(operation, operationInput);
  const context: WorkflowStepContext & WorkflowBlockingOperationRunner = {
    projectDir: input.projectDir,
    workspaceDir: input.workspaceDir,
    agentRuntime: resolveAgentRuntime(undefined),
    runtimeResources: {
      profileId: "test",
      env: {},
      agentRunDir: join(input.workspaceDir, ".kota/builder-evidence", PRESERVED_RUN_ID),
    },
    workflow: {
      name: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runId: PRESERVED_RUN_ID,
      runDir: `.kota/runs/${PRESERVED_RUN_ID}`,
      runDirPath,
    },
    trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
    previousOutput: undefined,
    stepOutputs: {
      "claim-task": { claimed: true, taskId: PRESERVED_TASK_ID },
      "prepare-worktree": {
        enabled: true,
        projectDir: input.projectDir,
        workspaceDir: input.workspaceDir,
        runtimeResources: { profileId: "test", env: {} },
        branch: input.branch,
        baseCommit: input.baseCommit,
        headCommit: fixtureGit(input.workspaceDir, ["rev-parse", "HEAD"]),
        taskId: PRESERVED_TASK_ID,
        claimId: "fixture-claim",
        worktreeRunId: PRESERVED_RUN_ID,
        claimPath: null,
        metadataPath: null,
        copiedSetupFiles: [],
      },
    },
    stepResults: {},
    stepOutputList: [],
    runAgentHarness: async () => ({
      text: response,
      streamedText: response,
      turns: 1,
      isError: false,
    }),
    runTool: async () => ({ content: "ok" }),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
    reportProgress: () => {},
    triggerWorkflow: async () => ({ runId: "unused", status: "queued" as const }),
    runBlocking,
  };
  const parentStep = {
    id: "build",
    type: "agent",
    harness: harnessName,
    promptPath: "prompt.md",
    model: "capable-model",
    effort: "xhigh",
    autonomyMode: "autonomous",
  } as WorkflowAgentStep;
  const decision = await builderContinuationController.evaluate(
    {
      attempt: 0,
      failureIds: ["critic-review"],
      warningIds: [],
      progressKey: "initial-progress",
      previousProgressKey: "initial-progress",
      progressChanged: false,
      noProgressAttempts: 0,
      repairIterations: [],
    },
    context,
    parentStep,
  );
  if (decision === null) throw new Error("preserve-yield decision is missing");
  return decision;
}

export function failedCheckpointMetadata(): WorkflowRunMetadata {
  return {
    id: PRESERVED_RUN_ID,
    workflow: "builder",
    status: "failed",
    runDir: `.kota/runs/${PRESERVED_RUN_ID}`,
    steps: [
      { id: "prepare-worktree", output: { enabled: true, taskId: PRESERVED_TASK_ID } },
      {
        id: "build",
        type: "agent",
        status: "failed",
        output: { continuationDecisions: [] },
      },
    ],
  } as WorkflowRunMetadata;
}
