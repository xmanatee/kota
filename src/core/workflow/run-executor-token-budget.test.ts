import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type {
  AgentHarness,
  AgentHarnessRunOptions,
} from "#core/agent-harness/types.js";
import { unpricedAgentUsage } from "#core/agent-harness/usage.js";
import { EventBus } from "#core/events/event-bus.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
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

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", schemaRef: null, payload: {} };

function registerWorkflowScenarioDriver(
  name: string,
  run: AgentHarness["run"],
): void {
  registerAgentHarness({
    name,
    description: "workflow test harness",
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
  overrides: Partial<WorkflowAgentStep> = {},
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
    ...overrides,
  };
}

describe("workflow agent token budget", () => {
  let workspaceRoot: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-workflow-token-budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    store = new WorkflowRunStore(workspaceRoot);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("shares a config token-budget ledger across agent steps in one run", async () => {
    const harness = "workflow-run-scoped-token-budget";
    const executedSteps: string[] = [];
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      executedSteps.push(options.workflowContext?.stepId ?? "unknown");
      return {
        text: "done",
        streamedText: "done",
        turns: 1,
        usage: unpricedAgentUsage(50, 10),
        isError: false,
      };
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, { id: "first" }),
        makeAgentStep(workspaceRoot, harness, { id: "second" }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: makeRunContext(workspaceRoot, TRIGGER),
      bus,
      store,
      log,
      config: { workflow: { agentTokenBudget: { maxTotalTokens: 100 } } },
    });
    const result = await promise;

    expect(executedSteps).toEqual(["first", "second"]);
    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps.find((step) => step.id === "first")).toMatchObject({
      status: "success",
    });
    expect(result.metadata.steps.find((step) => step.id === "second")).toMatchObject({
      status: "failed",
      error: expect.stringContaining("token_budget_exhausted"),
    });

    const secondArtifact = JSON.parse(
      readFileSync(
        join(workspaceRoot, result.metadata.runDir, "steps", "second.token-budget.json"),
        "utf-8",
      ),
    ) as { snapshot: { usage: { totalTokens: number }; exhausted: boolean } };
    expect(secondArtifact.snapshot).toMatchObject({
      usage: { totalTokens: 120 },
      exhausted: true,
    });
  });
});
