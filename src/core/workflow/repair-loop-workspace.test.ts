import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrajectoryDiagnosticsMetadata } from "#core/agent-harness/index.js";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type { AgentHarness } from "#core/agent-harness/types.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { runAgentRepairLoop } from "./repair-loop.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepContext,
} from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import { AgentWriteScopeViolationError } from "./steps/agent-write-scope.js";
import type { AgentStepResult } from "./steps/step-executor-agent.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", schemaRef: null, payload: {} };

const EMPTY_TRAJECTORY_DIAGNOSTICS: TrajectoryDiagnosticsMetadata = {
  artifactPath: ".kota/runs/test/steps/agent.trajectory-diagnostics.json",
  warningCount: 0,
  unsupportedTrajectoryCount: 0,
  missingStreamingFramesCount: 0,
  missingFinalVerificationAfterEditCount: 0,
  repeatedIdenticalFailingCommandCount: 0,
  editAfterSuccessfulVerificationCount: 0,
  longPreambleWithoutTaskTouchCount: 0,
};

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function registerRepairHarness(
  name: string,
  run: AgentHarness["run"],
): void {
  registerAgentHarness({
    name,
    description: "repair-loop workspace test harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    run,
  });
}

function makeContext(projectDir: string, workspaceDir: string): WorkflowStepContext {
  return {
    projectDir,
    workspaceDir,
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
    runTool: async () => ({ content: "ok" }),
    emit: vi.fn(),
    requestRestart: vi.fn(),
    readPrompt: (promptPath) => readFileSync(join(projectDir, promptPath), "utf-8"),
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
    reportProgress: vi.fn(),
    triggerWorkflow: async () => ({ runId: "queued-run", status: "queued" }),
  };
}

function makeMetadata(projectDir: string): WorkflowRunMetadata {
  return {
    id: "run-001",
    workflow: "test-workflow",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    trigger: TRIGGER,
    startedAt: "2026-05-26T04:17:55.340Z",
    status: "running",
    runDir: ".kota/runs/run-001",
    steps: [],
  };
}

function makeStep(
  projectDir: string,
  harness: string,
  overrides: Partial<WorkflowAgentStep> = {},
): WorkflowAgentStep {
  writeFileSync(join(projectDir, "prompt.md"), "Run.\n", "utf-8");
  return {
    id: "agent",
    type: "agent",
    harness,
    promptPath: "prompt.md",
    moduleRoot: projectDir,
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
    repairLoop: {
      maxRepairAttempts: 1,
      checks: [],
    },
    ...overrides,
  };
}

function makeInitialResult(): AgentStepResult {
  return {
    output: { content: "initial", turns: 1, totalCostUsd: 0 },
    harness: "test-harness",
    model: "test-model",
    trajectoryDiagnostics: EMPTY_TRAJECTORY_DIAGNOSTICS,
    trajectoryMessages: [],
    preStepMutatedPaths: [],
  };
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
  writeFileSync(join(projectDir, "seed.txt"), "seed\n", "utf-8");
  execFileSync("git", ["add", "-A"], { cwd: projectDir });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: projectDir });
}

describe("runAgentRepairLoop workspaceDir", () => {
  let projectDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-repair-loop-canonical-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    workspaceDir = join(
      tmpdir(),
      `kota-repair-loop-workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("checks repair iteration mutations in workspaceDir while writing artifacts under projectDir", async () => {
    const harnessName = uniqueName("repair-workspace-write-scope");
    registerRepairHarness(harnessName, async () => {
      const outOfScope = join(workspaceDir, "src", "core", "escape.ts");
      mkdirSync(dirname(outOfScope), { recursive: true });
      writeFileSync(outOfScope, "export const escape = true;\n", "utf-8");
      return {
        text: "repair wrote a workspace file",
        streamedText: "repair wrote a workspace file",
        turns: 1,
        isError: false,
      };
    });

    let checkCount = 0;
    const step = makeStep(projectDir, harnessName, {
      agentName: "scoped-agent",
      repairLoop: {
        maxRepairAttempts: 1,
        checks: [
          {
            id: "fail-once",
            type: "code",
            run: () => {
              checkCount += 1;
              if (checkCount === 1) throw new Error("needs repair");
              return "ok";
            },
          },
        ],
      },
    });
    initGitRepo(projectDir);
    initGitRepo(workspaceDir);
    const agentDef: AgentDef = {
      name: "scoped-agent",
      role: "test",
      promptPath: "prompt.md",
      model: "test-model",
      effort: "low",
      writeScope: ["data/tasks/"],
    };

    await expect(
      runAgentRepairLoop(
        step,
        makeInitialResult(),
        makeContext(projectDir, workspaceDir),
        makeMetadata(projectDir),
        new AbortController(),
        vi.fn(),
        {
          projectDir,
          workspaceDir,
          resolveAgentDef: () => agentDef,
        },
      ),
    ).rejects.toThrow(AgentWriteScopeViolationError);

    const artifactPath = join(
      projectDir,
      ".kota/runs/run-001/steps/agent.write-scope-violation.json",
    );
    expect(existsSync(artifactPath)).toBe(true);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(artifact).toMatchObject({
      stepId: "agent",
      violations: ["src/core/escape.ts"],
    });
    expect(existsSync(join(workspaceDir, ".kota/runs/run-001"))).toBe(false);
  });
});
