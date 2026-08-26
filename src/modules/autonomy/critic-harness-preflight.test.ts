import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import { createWorkflowAgentHarnessRunner } from "#core/workflow/steps/workflow-agent-harness-runner.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { createCriticCheck } from "./critic.js";
import {
  type CriticReviewInspectionInput,
  inspectCriticReviewInWorker,
} from "./review-input-operations.js";

function makeParentStep(harness: string): WorkflowAgentStep {
  return {
    id: "build",
    type: "agent",
    promptPath: "prompt.md",
    moduleRoot: "/test-module-root",
    model: "fake-model",
    effort: "xhigh",
    autonomyMode: "autonomous",
    harness,
  };
}

function makeContext(
  workspaceRoot: string,
  runDir: string,
): WorkflowStepContext {
  return {
    workspaceRoot,
    workflow: {
      name: "builder",
      runId: "run-critic-preflight",
      runDir: ".kota/runs/run-critic-preflight",
      runDirPath: runDir,
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    },
    trigger: { event: "autonomy.queue.available", payload: {} },
    previousOutput: undefined,
    stepOutputs: {},
    stepResults: {},
    stepOutputList: [],
    runBlocking: async (
      _operation: { exportName: string },
      input: CriticReviewInspectionInput,
    ) =>
      inspectCriticReviewInWorker(input as CriticReviewInspectionInput) as never,
    runCommand: successfulWorkflowCommandRun,
    runTool: vi.fn(),
    runAgentHarness: createWorkflowAgentHarnessRunner(undefined),
    emit: vi.fn(),
    requestRestart: vi.fn(),
    readPrompt: vi.fn(),
    readRuntimeState: vi.fn(),
    triggerWorkflow: vi.fn(),
  } as unknown as WorkflowStepContext;
}

describe("critic harness tool-control preflight", () => {
  let workspaceRoot: string;
  let runDir: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-critic-harness-preflight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runDir = join(workspaceRoot, ".kota/runs/run-critic-preflight");
    mkdirSync(join(workspaceRoot, "data/tasks/doing"), { recursive: true });
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(workspaceRoot, "data/tasks/doing/task-preflight.md"),
      "---\nid: task-preflight\ntitle: Preflight\nstatus: doing\npriority: p1\narea: architecture\nsummary: Exercise critic preflight.\n---\n\n## Done When\n\n- The critic runs.\n",
    );
    execFileSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: workspaceRoot,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "Test User"], {
      cwd: workspaceRoot,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], {
      cwd: workspaceRoot,
      stdio: "ignore",
    });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("fails before running the inherited judge harness when canUseTool is unsupported", async () => {
    const run = vi.fn(async () => ({
      text: '{"verdict":"pass","critical_issues":[],"warnings":[],"summary":"should not run"}',
      streamedText: "",
      turns: 1,
      isError: false,
    }));
    const harness: AgentHarness = {
      name: "critic-unsupported-tool-control",
      description: "test-only critic harness without KOTA tool-control support",
      supportsMultiTurn: true,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      unsupportedRunOptions: [
        {
          runOption: "canUseTool",
          option: "canUseTool",
          reason: "this judge harness cannot enforce KOTA tool gates",
        },
      ],
      run,
    };
    registerAgentHarness(harness);

    const check = createCriticCheck({
      runDirPath: runDir,
      model: "fake-model",
    });
    if (check.type !== "code") throw new Error("expected code repair check");

    await expect(
      check.run(makeContext(workspaceRoot, runDir), makeParentStep(harness.name)),
    ).rejects.toThrow(/critic-unsupported-tool-control.*canUseTool/);
    expect(run).not.toHaveBeenCalled();
  });
});
