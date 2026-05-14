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
import { createCriticCheck } from "./critic.js";

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

function makeContext(projectDir: string, runDir: string): WorkflowStepContext {
  return {
    projectDir,
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
    runTool: vi.fn(),
    emit: vi.fn(),
    requestRestart: vi.fn(),
    readPrompt: vi.fn(),
    readRuntimeState: vi.fn(),
    triggerWorkflow: vi.fn(),
  } as unknown as WorkflowStepContext;
}

describe("critic harness tool-control preflight", () => {
  let projectDir: string;
  let runDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-critic-harness-preflight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runDir = join(projectDir, ".kota/runs/run-critic-preflight");
    mkdirSync(join(projectDir, "data/tasks/doing"), { recursive: true });
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(projectDir, "data/tasks/doing/task-preflight.md"),
      "---\nid: task-preflight\ntitle: Preflight\nstatus: doing\npriority: p1\narea: architecture\nsummary: Exercise critic preflight.\n---\n\n## Done When\n\n- The critic runs.\n",
    );
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
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
      check.run(makeContext(projectDir, runDir), makeParentStep(harness.name)),
    ).rejects.toThrow(/critic-unsupported-tool-control.*canUseTool/);
    expect(run).not.toHaveBeenCalled();
  });
});
