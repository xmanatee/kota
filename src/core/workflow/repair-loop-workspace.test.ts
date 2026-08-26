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
import {
  registerAgentHarness,
  resolveAgentHarness,
} from "#core/agent-harness/registry.js";
import type { AgentHarness } from "#core/agent-harness/types.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { runAgentRepairLoop } from "./repair-loop.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepContext,
} from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import { AgentWriteScopeViolationError } from "./steps/agent-write-scope.js";
import type { AgentStepResult } from "./steps/step-executor-agent.js";
import { createWorkflowAgentHarnessRunner } from "./steps/workflow-agent-harness-runner.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import { createWorkflowCommandRunner } from "./workflow-command.js";

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", schemaRef: null, payload: {} };
const runAgentHarness = createWorkflowAgentHarnessRunner(undefined);

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

function makeContext(workspaceRoot: string, workspaceDir: string): WorkflowStepContext {
  return {
    scopeId: "test-scope",
    workspaceRoot: workspaceDir,
    scopeRoot: workspaceRoot,
    stateDir: join(workspaceRoot, ".kota"),
    agentRuntime: resolveAgentRuntime(undefined),
    workflow: {
      name: "test-workflow",
      definitionPath: "src/modules/test/workflows/test/workflow.ts",
      runId: "run-001",
      runDir: ".kota/runs/run-001",
      runDirPath: join(workspaceRoot, ".kota/runs/run-001"),
    },
    trigger: TRIGGER,
    previousOutput: undefined,
    stepOutputs: {},
    stepResults: {},
    stepOutputList: [],
    runAgentHarness,
    runCommand: createWorkflowCommandRunner({ cwd: workspaceDir }),
    runTool: async () => ({ content: "ok" }),
    emit: vi.fn(),
    requestRestart: vi.fn(),
    readPrompt: (promptPath) => readFileSync(join(workspaceRoot, promptPath), "utf-8"),
    readRuntimeState: () => ({ completedRuns: 0, workflows: {} }),
    state: createTestTransactionalRunState(),
    reportProgress: vi.fn(),
    triggerWorkflow: async () => ({ runId: "queued-run", status: "queued" }),
  };
}

function makeMetadata(_scopeRoot: string): WorkflowRunMetadata {
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
  workspaceRoot: string,
  harness: string,
  overrides: Partial<WorkflowAgentStep> = {},
): WorkflowAgentStep {
  writeFileSync(join(workspaceRoot, "prompt.md"), "Run.\n", "utf-8");
  return {
    id: "agent",
    type: "agent",
    harness,
    promptPath: "prompt.md",
    moduleRoot: workspaceRoot,
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

function initGitRepo(workspaceRoot: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "t@example.com"], {
    cwd: workspaceRoot,
  });
  execFileSync("git", ["config", "user.name", "test"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: workspaceRoot,
  });
  writeFileSync(join(workspaceRoot, "seed.txt"), "seed\n", "utf-8");
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: workspaceRoot });
}

describe("runAgentRepairLoop workspaceDir", () => {
  let workspaceRoot: string;
  let workspaceDir: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-repair-loop-canonical-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    workspaceDir = join(
      tmpdir(),
      `kota-repair-loop-workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("checks repair iteration mutations in workspaceDir while writing artifacts under workspaceRoot", async () => {
    const harnessName = uniqueName("repair-workspace-write-scope");
    registerRepairHarness(harnessName, async () => {
      const outOfScope = join(workspaceDir, "src", "core", "escape.ts");
      mkdirSync(dirname(outOfScope), { recursive: true });
      writeFileSync(outOfScope, "export const escape = true;\n", "utf-8");
      return {
        text: "repair wrote a workspace file",
        streamedText: "repair wrote a workspace file",
        turns: 1,
        usage: { tokens: { state: "unknown" }, cost: { state: "unknown" } },
        isError: false,
      };
    });

    let checkCount = 0;
    const step = makeStep(workspaceRoot, harnessName, {
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
    initGitRepo(workspaceRoot);
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
        makeContext(workspaceRoot, workspaceDir),
        makeMetadata(workspaceRoot),
        new AbortController(),
        vi.fn(),
        {
          scopeRoot: workspaceRoot,
          workspaceRoot: workspaceDir,
          resolveAgentHarness,
          resolveAgentDef: () => agentDef,
        },
      ),
    ).rejects.toThrow(AgentWriteScopeViolationError);

    const artifactPath = join(
      workspaceRoot,
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
