import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type { AgentHarness } from "#core/agent-harness/types.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { RepairLoopYield, runAgentRepairLoop } from "./repair-loop.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import type { AgentStepResult } from "./steps/step-executor-agent.js";
import { createWorkflowAgentHarnessRunner } from "./steps/workflow-agent-harness-runner.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};
const runAgentHarness = createWorkflowAgentHarnessRunner(undefined);

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function registerRepairHarness(name: string, run: AgentHarness["run"]): void {
  registerAgentHarness({
    name,
    description: "repair continuation test harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    run,
  });
}

function initGitRepo(projectDir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
  execFileSync("git", ["config", "user.email", "t@example.com"], {
    cwd: projectDir,
  });
  execFileSync("git", ["config", "user.name", "test"], { cwd: projectDir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: projectDir,
  });
  writeFileSync(join(projectDir, "seed.txt"), "seed\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: projectDir });
}

function makeContext(projectDir: string): WorkflowStepContext {
  return {
    projectDir,
    agentRuntime: resolveAgentRuntime(undefined),
    workflow: {
      name: "test-workflow",
      definitionPath: "src/modules/test/workflows/test/workflow.ts",
      runId: "run-001",
      runDir: ".kota/runs/run-001",
      runDirPath: join(projectDir, ".kota/runs/run-001"),
    },
    trigger: TRIGGER,
    previousOutput: undefined,
    stepOutputs: {},
    stepResults: {},
    stepOutputList: [],
    runAgentHarness,
    runTool: async () => ({ content: "ok" }),
    emit: vi.fn(),
    requestRestart: vi.fn(),
    readPrompt: () => "Run.\n",
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
    reportProgress: vi.fn(),
    triggerWorkflow: async () => ({ runId: "queued-run", status: "queued" }),
  };
}

function makeMetadata(): WorkflowRunMetadata {
  return {
    id: "run-001",
    workflow: "test-workflow",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    trigger: TRIGGER,
    startedAt: "2026-08-23T20:51:16.959Z",
    status: "running",
    runDir: ".kota/runs/run-001",
    steps: [],
  };
}

function makeStep(
  projectDir: string,
  harness: string,
  repairLoop: WorkflowAgentStep["repairLoop"],
): WorkflowAgentStep {
  writeFileSync(join(projectDir, "prompt.md"), "Run.\n", "utf8");
  return {
    id: "agent",
    type: "agent",
    harness,
    promptPath: "prompt.md",
    moduleRoot: projectDir,
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
    repairLoop,
  };
}

function makeInitialResult(): AgentStepResult {
  return {
    output: { content: "initial", turns: 1, totalCostUsd: 0 },
    harness: "test-harness",
    model: "test-model",
    trajectoryDiagnostics: {
      artifactPath: ".kota/runs/run-001/steps/agent.trajectory-diagnostics.json",
      warningCount: 0,
      unsupportedTrajectoryCount: 0,
      missingStreamingFramesCount: 0,
      missingFinalVerificationAfterEditCount: 0,
      repeatedIdenticalFailingCommandCount: 0,
      editAfterSuccessfulVerificationCount: 0,
      longPreambleWithoutTaskTouchCount: 0,
    },
    trajectoryMessages: [],
    preStepMutatedPaths: [],
  };
}

describe("runAgentRepairLoop continuation authority", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), uniqueName("kota-repair-continuation"));
    mkdirSync(projectDir, { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("stops at preserve-yield with its evidence packet in step output", async () => {
    const harnessName = uniqueName("repair-preserve-yield");
    registerRepairHarness(harnessName, async () => {
      writeFileSync(join(projectDir, "progress.txt"), "useful checkpoint\n", "utf8");
      return {
        text: "checkpointed useful work",
        streamedText: "checkpointed useful work",
        turns: 1,
        isError: false,
      };
    });
    const evaluate = vi.fn((input: { attempt: number; progressKey: string }) =>
      input.attempt === 1
        ? {
            decision: "preserve-yield" as const,
            evidenceKey: "priority-boundary",
            summary: "Useful work is durable and P0 runtime work is ready.",
            nextAction: "Let dispatcher priority choose the next builder run.",
            packet: {
              schemaVersion: 1 as const,
              boundaryKey: "priority-boundary",
              boundaryReasons: ["higher-priority:task-p0:p0:Safety"],
              attempt: input.attempt,
              failureIds: ["always-fails"],
              warningIds: [],
              progressKey: input.progressKey,
              trajectory: {
                classification: "changing",
                attempts: input.attempt,
                failureIdsByAttempt: [["always-fails"]],
              },
              context: [{ label: "queue", value: "P0 task is ready" }],
            },
          }
        : null,
    );
    const step = makeStep(projectDir, harnessName, {
      checks: [
        {
          id: "always-fails",
          type: "code",
          run: () => {
            throw new Error("still failing");
          },
        },
      ],
      continuation: { evaluate },
    });

    await expect(
      runAgentRepairLoop(
        step,
        makeInitialResult(),
        makeContext(projectDir),
        makeMetadata(),
        new AbortController(),
        vi.fn(),
        { projectDir },
      ),
    ).rejects.toMatchObject({
      name: RepairLoopYield.name,
      output: {
        continuationDecisions: [
          { decision: "preserve-yield", evidenceKey: "priority-boundary" },
        ],
      },
    });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("keeps a converging repair alive after a continue decision", async () => {
    const harnessName = uniqueName("repair-continue");
    let repairRuns = 0;
    registerRepairHarness(harnessName, async () => {
      repairRuns += 1;
      writeFileSync(join(projectDir, "progress.txt"), `checkpoint ${repairRuns}\n`, "utf8");
      return {
        text: `repair ${repairRuns}`,
        streamedText: `repair ${repairRuns}`,
        turns: 1,
        isError: false,
      };
    });
    let checkRuns = 0;
    const step = makeStep(projectDir, harnessName, {
      checks: [
        {
          id: "converging-check",
          type: "code",
          run: () => {
            checkRuns += 1;
            if (checkRuns < 3) throw new Error("one issue remains");
            return "ok";
          },
        },
      ],
      continuation: {
        evaluate: (input) =>
          input.attempt === 1
            ? {
                decision: "continue",
                evidenceKey: "converging-boundary",
                summary: "Verification failures are shrinking.",
                nextAction: "Finish the remaining focused repair.",
                packet: {
                  schemaVersion: 1,
                  boundaryKey: "converging-boundary",
                  boundaryReasons: ["repair-trajectory:converging"],
                  attempt: input.attempt,
                  failureIds: input.failureIds,
                  warningIds: input.warningIds,
                  progressKey: input.progressKey,
                  trajectory: {
                    classification: "converging",
                    attempts: input.attempt,
                    failureIdsByAttempt: input.repairIterations.map(
                      (iteration) => iteration.failureIds,
                    ),
                  },
                  context: [{ label: "verification", value: "1 issue remains" }],
                },
              }
            : null,
      },
    });

    const result = await runAgentRepairLoop(
      step,
      makeInitialResult(),
      makeContext(projectDir),
      makeMetadata(),
      new AbortController(),
      vi.fn(),
      { projectDir },
    );

    expect(result.output).toMatchObject({
      content: "repair 2",
      continuationDecisions: [{ decision: "continue" }],
      repairIterations: [{ attempt: 1 }, { attempt: 2 }],
    });
  });
});
