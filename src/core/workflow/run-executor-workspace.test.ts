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
import type { ToolRunnerContext } from "#core/tools/index.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import type { RunContext } from "./run-context.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowAgentStep } from "./step-types.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

function makeRunContext(
  projectDir: string,
  trigger: RunContext["trigger"],
  runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  workspaceDir = projectDir,
): RunContext {
  return {
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    project: { id: "test-project", root: projectDir },
    workflow: "test",
    trigger,
    sandbox: {
      runId,
      repository: "none",
      rootDir: projectDir,
      workspaceDir,
      tempDir: projectDir,
      artifactDir: projectDir,
    },
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir,
      runDir: projectDir,
      tempDir: projectDir,
      artifactDir: projectDir,
      agentDir: projectDir,
      packageCacheDir: projectDir,
      ports: { start: 41_000, end: 41_000, size: 1, values: [41_000] },
      env: {},
    },
    signal: new AbortController().signal,
    processes: { register: vi.fn() },
    effects: { execute: (effect) => effect.execute() },
    publications: { stageEmit: vi.fn() },
    state: createTestTransactionalRunState(),
  };
}



const TRIGGER: WorkflowRunTrigger = {
  event: "runtime.idle",
  schemaRef: null,
  payload: {},
};

const AGENT_OK_RESULT: AgentHarnessResult = {
  text: "done",
  streamedText: "done",
  turns: 1,
  usage: {
    tokens: { state: "unknown" },
    cost: { state: "unknown" },
  },
  isError: false,
};

function makeDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    repository: "none",
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

  it("uses the run-owned workspace while keeping scope state and artifacts under the project", async () => {
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
    let toolContext: ToolRunnerContext | undefined;
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
              scopeDir: ctx.scopeDir,
              workspaceDir: ctx.projectDir,
              runDirPath: ctx.workflow.runDirPath,
            };
          },
        },
        makeAgentStep(projectDir, harness),
      ],
    });

    try {
      const { promise } = executeWorkflowRun(definition, TRIGGER, {
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        runContext: makeRunContext(projectDir, TRIGGER, undefined, workspaceDir),
        bus,
        store,
        log,
        runTool: async (_name, _input, context) => {
          toolContext = context;
          return { content: "ok" };
        },
      });
      const result = await promise;
      const output = result.metadata.steps[0]?.output as {
        projectDir: string;
        scopeDir: string;
        workspaceDir: string;
        runDirPath: string;
      };

      expect(result.metadata.status).toBe("success");
      expect(output).toEqual({
        projectDir: workspaceDir,
        scopeDir: projectDir,
        workspaceDir,
        runDirPath: join(projectDir, result.metadata.runDir),
      });
      expect(toolContext).toMatchObject({
        projectDir,
        cwd: workspaceDir,
        sessionId: expect.stringMatching(/^workflow:/),
        scopeId: expect.any(String),
      });
      expect(agentOptions?.projectDir).toBe(projectDir);
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

});
