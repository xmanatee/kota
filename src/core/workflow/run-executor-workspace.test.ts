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
import type { RunContext } from "./run-context.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowAgentStep } from "./step-types.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

function makeRunContext(
  workspaceRoot: string,
  trigger: RunContext["trigger"],
  runId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  workspaceDir = workspaceRoot,
): RunContext {
  return {
    run: { id: runId, attempt: 1, daemonEpoch: 1 },
    scope: { id: "test-scope", root: workspaceRoot },
    workflow: "test",
    trigger,
    sandbox: {
      runId,
      repository: "none",
      rootDir: workspaceRoot,
      workspaceDir,
      tempDir: workspaceRoot,
      artifactDir: workspaceRoot,
    },
    resources: {
      runId,
      attempt: 1,
      daemonEpoch: 1,
      workspaceDir,
      runDir: workspaceRoot,
      tempDir: workspaceRoot,
      artifactDir: workspaceRoot,
      agentDir: workspaceRoot,
      packageCacheDir: workspaceRoot,
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
  workspaceRoot: string,
  harness: string,
): WorkflowAgentStep {
  writeFileSync(join(workspaceRoot, "prompt.md"), "Run.\n");
  return {
    id: "agent",
    type: "agent",
    harness,
    promptPath: "prompt.md",
    moduleRoot: workspaceRoot,
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
  };
}

describe("workflow workspaceDir execution", () => {
  let workspaceRoot: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-run-executor-workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    store = new WorkflowRunStore(workspaceRoot);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("uses the run-owned workspace while keeping scope state and artifacts under the scope root", async () => {
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
      moduleRoot: workspaceRoot,
      steps: [
        {
          id: "inspect",
          type: "code",
          run: async (ctx) => {
            await ctx.runTool("capture", {});
            return {
              workspaceRoot: ctx.workspaceRoot,
              scopeRoot: ctx.scopeRoot,
              workspaceDir: ctx.workspaceRoot,
              runDirPath: ctx.workflow.runDirPath,
            };
          },
        },
        makeAgentStep(workspaceRoot, harness),
      ],
    });

    try {
      const { promise } = executeWorkflowRun(definition, TRIGGER, {
        runContext: makeRunContext(workspaceRoot, TRIGGER, undefined, workspaceDir),
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
        workspaceRoot: string;
        scopeRoot: string;
        workspaceDir: string;
        runDirPath: string;
      };

      expect(result.metadata.status).toBe("success");
      expect(output).toEqual({
        workspaceRoot: workspaceDir,
        scopeRoot: workspaceRoot,
        workspaceDir,
        runDirPath: join(workspaceRoot, result.metadata.runDir),
      });
      expect(toolContext).toMatchObject({
        scopeRoot: workspaceRoot,
        cwd: workspaceDir,
        sessionId: expect.stringMatching(/^workflow:/),
        scopeId: expect.any(String),
      });
      expect(agentOptions?.scopeRoot).toBe(workspaceRoot);
      expect(agentOptions?.cwd).toBe(workspaceDir);
      expect(
        existsSync(
          join(workspaceRoot, result.metadata.runDir, "steps", "agent.harness-capability.json"),
        ),
      ).toBe(true);
      expect(existsSync(join(workspaceDir, ".kota", "runs"))).toBe(false);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 10_000);

});
