import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import type { WorkflowBlockingOperationRunner } from "#core/workflow/blocking-operation.js";
import type {
  WorkflowRepairContinuationInput,
  WorkflowStepContext,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import { builderContinuationController, recordBuilderContinuationInWorker } from "./continuation-controller.js";
import { inspectBuilderContinuationInWorker } from "./continuation-inspection.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(): {
  projectDir: string;
  runDir: string;
  agentRunDir: string;
} {
  const projectDir = mkdtempSync(join(tmpdir(), "builder-continuation-judge-"));
  tempDirs.push(projectDir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
  execFileSync("git", ["config", "user.email", "builder@example.com"], {
    cwd: projectDir,
  });
  execFileSync("git", ["config", "user.name", "Builder Test"], {
    cwd: projectDir,
  });
  mkdirSync(join(projectDir, "data/tasks/doing"), { recursive: true });
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(
    join(projectDir, "data/tasks/doing/task-long-builder.md"),
    `---
id: task-long-builder
title: Long builder
status: doing
priority: p1
area: autonomy
task_class: Meta
summary: Finish useful work without monopolizing the builder slot.
created_at: 2026-08-13T00:00:00.000Z
updated_at: 2026-08-13T00:00:00.000Z
---

## Done When

- The repair trajectory reaches a typed decision.
`,
  );
  writeFileSync(join(projectDir, "src/work.ts"), "export const work = 1;\n");
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: projectDir });
  writeFileSync(join(projectDir, "src/work.ts"), "export const work = 2;\n");
  const runDir = join(projectDir, ".kota/runs/run-long-builder");
  const agentRunDir = join(projectDir, ".kota/builder-evidence/run-long-builder");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(agentRunDir, { recursive: true });
  writeFileSync(join(agentRunDir, "success-criteria.txt"), "1. Finish.\n");
  return { projectDir, runDir, agentRunDir };
}

let harnessSequence = 0;

function evaluationFixture(
  runAgentHarness: WorkflowStepContext["runAgentHarness"],
): {
  context: WorkflowStepContext & WorkflowBlockingOperationRunner;
  continuation: WorkflowRepairContinuationInput;
  parentStep: WorkflowAgentStep;
  runDir: string;
} {
  const { projectDir, runDir, agentRunDir } = fixture();
  const harnessName = `builder-continuation-${harnessSequence++}`;
  registerAgentHarness({
    name: harnessName,
    description: "builder continuation test harness",
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
  const runBlocking: WorkflowBlockingOperationRunner["runBlocking"] = async (
    operation,
    input,
  ) => {
    if (operation.exportName === "inspectBuilderContinuationInWorker") {
      return inspectBuilderContinuationInWorker(input as any) as any;
    }
    if (operation.exportName === "recordBuilderContinuationInWorker") {
      return recordBuilderContinuationInWorker(input as any) as any;
    }
    throw new Error(`Unexpected operation ${operation.exportName}`);
  };
  const context = {
    projectDir,
    agentRuntime: resolveAgentRuntime(undefined),
    workspaceDir: projectDir,
    runtimeResources: { profileId: "test", env: {}, agentRunDir },
    workflow: {
      name: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runId: "run-long-builder",
      runDir: ".kota/runs/run-long-builder",
      runDirPath: runDir,
    },
    trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
    previousOutput: undefined,
    stepOutputs: {
      "claim-task": { claimed: true, taskId: "task-long-builder" },
    },
    stepResults: {},
    stepOutputList: [],
    runAgentHarness,
    runTool: async () => ({ content: "ok" }),
    emit: vi.fn(),
    requestRestart: vi.fn(),
    readPrompt: vi.fn(),
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
    reportProgress: vi.fn(),
    triggerWorkflow: vi.fn(),
    runBlocking,
  } as unknown as WorkflowStepContext & WorkflowBlockingOperationRunner;
  const parentStep = {
    id: "build",
    type: "agent",
    harness: harnessName,
    promptPath: "prompt.md",
    model: "capable-model",
    effort: "xhigh",
    autonomyMode: "autonomous",
  } as WorkflowAgentStep;
  const continuation: WorkflowRepairContinuationInput = {
    attempt: 3,
    failureIds: ["critic-review"],
    warningIds: [],
    progressKey: "progress-3",
    previousProgressKey: "progress-2",
    progressChanged: true,
    noProgressAttempts: 0,
    repairIterations: [
      { attempt: 1, failureIds: ["critic-review"] },
      { attempt: 2, failureIds: ["critic-review"] },
      { attempt: 3, failureIds: ["critic-review"] },
    ],
  };
  return { context, continuation, parentStep, runDir };
}

describe("builder continuation controller", () => {
  it("sends the compact packet to the inherited capable judge and records its typed decision", async () => {
    let judgeOptions: AgentHarnessRunOptions | undefined;
    const runAgentHarness = vi.fn(async (_harness, options) => {
      judgeOptions = options;
      return {
        text: JSON.stringify({
          decision: "continue",
          summary: "The remaining verification failure is narrow and repairable.",
          nextAction: "Finish the focused repair and rerun verification.",
          evidence: [
            "trajectory.classification=stalled-changing",
            "context.diff records a durable worktree change",
          ],
        }),
        streamedText: "continuation decision",
        turns: 1,
        isError: false,
      };
    });
    const { context, continuation, parentStep, runDir } = evaluationFixture(
      runAgentHarness,
    );

    const decision = await builderContinuationController.evaluate(
      continuation,
      context,
      parentStep,
    );

    expect(decision).toMatchObject({
      decision: "continue",
      packet: { trajectory: { classification: "stalled-changing" } },
    });
    expect(judgeOptions?.model).toBe("capable-model");
    expect(judgeOptions?.prompt).toContain(
      '<untrusted-content source="builder.continuation.evidence">',
    );
    expect(judgeOptions?.prompt).toContain('"classification": "stalled-changing"');
    expect(
      JSON.parse(
        readFileSync(join(runDir, "builder-continuation.json"), "utf8"),
      ),
    ).toMatchObject({
      runId: "run-long-builder",
      decisions: [{ decision: "continue" }],
    });
  });

  it("fails closed when the continuation judge cannot produce a verdict", async () => {
    const runAgentHarness = vi.fn(async () => ({
      text: "Reached maximum number of turns",
      streamedText: "Reached maximum number of turns",
      turns: 12,
      isError: true,
      subtype: "error_max_turns",
    }));
    const { context, continuation, parentStep, runDir } = evaluationFixture(
      runAgentHarness,
    );

    await expect(
      builderContinuationController.evaluate(continuation, context, parentStep),
    ).rejects.toThrow(/maximum number of turns/i);
    expect(() =>
      readFileSync(join(runDir, "builder-continuation.json"), "utf8"),
    ).toThrow();
  });
});
