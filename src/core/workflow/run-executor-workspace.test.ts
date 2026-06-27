import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
} from "#core/agent-harness/types.js";
import { EventBus } from "#core/events/event-bus.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowAgentStep } from "./step-types.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

const AGENT_OK_RESULT: AgentHarnessResult = {
  text: "done",
  streamedText: "done",
  turns: 1,
  isError: false,
};

function makeDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    recoveryCapable: false,
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [],
    steps: [],
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

function registerWorkflowTestHarness(
  name: string,
  run: AgentHarness["run"],
): void {
  registerAgentHarness({
    name,
    description: "workflow workspace test harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: true,
    toolControl: "kota",
    run,
  });
}

function makeAgentStep(
  projectDir: string,
  harness: string,
): WorkflowAgentStep {
  writeFileSync(join(projectDir, "prompt.md"), "Run.\n");
  return {
    id: "agent",
    type: "agent",
    harness,
    promptPath: "prompt.md",
    moduleRoot: projectDir,
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
  };
}

describe("workflow workspaceDir execution", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-run-executor-workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("defaults workflow workspaceDir to projectDir for code, tool, and agent execution", async () => {
    const harness = "workflow-default-workspace";
    let agentCwd: string | undefined;
    registerWorkflowTestHarness(harness, async (options: AgentHarnessRunOptions) => {
      agentCwd = options.cwd;
      return AGENT_OK_RESULT;
    });
    let toolCwd: string | undefined;
    const definition = makeDefinition({
      moduleRoot: projectDir,
      steps: [
        {
          id: "inspect",
          type: "code",
          run: async (ctx) => {
            await ctx.runTool("capture", {});
            return { projectDir: ctx.projectDir, workspaceDir: ctx.workspaceDir };
          },
        },
        makeAgentStep(projectDir, harness),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
      runTool: async (_name, _input, context) => {
        toolCwd = context?.cwd;
        return { content: "ok" };
      },
    });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[0]?.output).toEqual({
      projectDir,
      workspaceDir: projectDir,
    });
    expect(toolCwd).toBe(projectDir);
    expect(agentCwd).toBe(projectDir);
  }, 10_000);

  it("runs agent and tool work in workspaceDir while keeping artifacts under projectDir", async () => {
    const workspaceDir = join(
      tmpdir(),
      `kota-run-executor-worktree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceDir, { recursive: true });
    const harness = "workflow-workspace-override";
    let agentOptions: AgentHarnessRunOptions | undefined;
    registerWorkflowTestHarness(harness, async (options: AgentHarnessRunOptions) => {
      agentOptions = options;
      return AGENT_OK_RESULT;
    });
    let toolCwd: string | undefined;
    const definition = makeDefinition({
      moduleRoot: projectDir,
      steps: [
        {
          id: "inspect",
          type: "code",
          run: async (ctx) => {
            await ctx.runTool("capture", {});
            return {
              projectDir: ctx.projectDir,
              workspaceDir: ctx.workspaceDir,
              runDirPath: ctx.workflow.runDirPath,
            };
          },
        },
        makeAgentStep(projectDir, harness),
      ],
    });

    try {
      const { promise } = executeWorkflowRun(definition, TRIGGER, {
        projectDir,
        workspaceDir,
        bus,
        store,
        log,
        runTool: async (_name, _input, context) => {
          toolCwd = context?.cwd;
          return { content: "ok" };
        },
      });
      const result = await promise;
      const output = result.metadata.steps[0]?.output as {
        projectDir: string;
        workspaceDir: string;
        runDirPath: string;
      };

      expect(result.metadata.status).toBe("success");
      expect(output).toEqual({
        projectDir,
        workspaceDir,
        runDirPath: join(projectDir, result.metadata.runDir),
      });
      expect(toolCwd).toBe(workspaceDir);
      expect(agentOptions?.cwd).toBe(workspaceDir);
      expect(
        existsSync(
          join(projectDir, result.metadata.runDir, "steps", "agent.harness-capability.json"),
        ),
      ).toBe(true);
      expect(existsSync(join(workspaceDir, ".kota", "runs"))).toBe(false);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 10_000);

  it("updates workflow workspaceDir from an explicit top-level code step", async () => {
    const workspaceDir = join(
      tmpdir(),
      `kota-run-executor-updated-worktree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceDir, { recursive: true });
    const harness = "workflow-dynamic-workspace";
    let agentCwd: string | undefined;
    registerWorkflowTestHarness(harness, async (options: AgentHarnessRunOptions) => {
      agentCwd = options.cwd;
      return AGENT_OK_RESULT;
    });
    let toolCwd: string | undefined;
    const definition = makeDefinition({
      moduleRoot: projectDir,
      steps: [
        {
          id: "prepare-workspace",
          type: "code",
          updatesWorkspaceDir: true,
          run: (ctx) => ({
            projectDir: ctx.projectDir,
            workspaceDir,
          }),
        },
        {
          id: "inspect",
          type: "code",
          run: async (ctx) => {
            await ctx.runTool("capture", {});
            return {
              projectDir: ctx.projectDir,
              workspaceDir: ctx.workspaceDir,
              runDirPath: ctx.workflow.runDirPath,
            };
          },
        },
        makeAgentStep(projectDir, harness),
      ],
    });

    try {
      const { promise } = executeWorkflowRun(definition, TRIGGER, {
        projectDir,
        bus,
        store,
        log,
        runTool: async (_name, _input, context) => {
          toolCwd = context?.cwd;
          return { content: "ok" };
        },
      });
      const result = await promise;
      const output = result.metadata.steps[1]?.output as {
        projectDir: string;
        workspaceDir: string;
        runDirPath: string;
      };

      expect(result.metadata.status).toBe("success");
      expect(output).toEqual({
        projectDir,
        workspaceDir,
        runDirPath: join(projectDir, result.metadata.runDir),
      });
      expect(toolCwd).toBe(workspaceDir);
      expect(agentCwd).toBe(workspaceDir);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 10_000);
});
