import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual<typeof import("#modules/claude-agent-harness/executor.js")>(
    "#modules/claude-agent-harness/executor.js",
  );
  return { ...actual, executeWithAgentSDK: vi.fn() };
});

import "#modules/claude-agent-harness/index.js";

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

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

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", schemaRef: null, payload: {} };

describe("parallel step groups", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-parallel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("runs all child steps concurrently and records outputs by ID", async () => {
    const executed: string[] = [];
    let capturedOutputs: Record<string, unknown> = {};

    const definition = makeDefinition({
      steps: [
        {
          id: "parallel-fetch",
          type: "parallel",
          steps: [
            {
              id: "fetch-a",
              type: "code",
              run: () => {
                executed.push("fetch-a");
                return { value: "a" };
              },
            },
            {
              id: "fetch-b",
              type: "code",
              run: () => {
                executed.push("fetch-b");
                return { value: "b" };
              },
            },
          ],
        },
        {
          id: "consume",
          type: "code",
          run: (ctx) => {
            capturedOutputs = { ...ctx.stepOutputs };
            return "done";
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(executed).toContain("fetch-a");
    expect(executed).toContain("fetch-b");
    expect(capturedOutputs["fetch-a"]).toEqual({ value: "a" });
    expect(capturedOutputs["fetch-b"]).toEqual({ value: "b" });
    expect((capturedOutputs["parallel-fetch"] as { steps: unknown[] }).steps).toHaveLength(2);
  });

  it("aborts the workflow when a child step fails without continueOnFailure", async () => {
    const executed: string[] = [];
    const completed: unknown[] = [];
    bus.on("workflow.completed", (payload) => completed.push(payload));

    const definition = makeDefinition({
      steps: [
        {
          id: "parallel-work",
          type: "parallel",
          steps: [
            {
              id: "good-step",
              type: "code",
              run: () => {
                executed.push("good-step");
                return "ok";
              },
            },
            {
              id: "bad-step",
              type: "code",
              run: () => {
                executed.push("bad-step");
                throw new Error("child failure");
              },
            },
          ],
        },
        {
          id: "unreachable",
          type: "code",
          run: () => {
            executed.push("unreachable");
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    await promise;

    expect(executed).not.toContain("unreachable");
    expect((completed[0] as { status: string }).status).toBe("failed");
  });

  it("records all child results in the parallel group output", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "parallel-work",
          type: "parallel",
          steps: [
            {
              id: "step-a",
              type: "code",
              run: () => ({ result: "a" }),
            },
            {
              id: "step-b",
              type: "code",
              run: () => {
                throw new Error("b failed");
              },
            },
          ],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    const groupResult = result.metadata.steps[0];
    expect(groupResult.id).toBe("parallel-work");
    expect(groupResult.type).toBe("parallel");
    expect(groupResult.status).toBe("failed");
    const inner = (groupResult.output as { steps: Array<{ id: string; status: string }> }).steps;
    expect(inner).toHaveLength(2);
    expect(inner.find((s) => s.id === "step-a")?.status).toBe("success");
    expect(inner.find((s) => s.id === "step-b")?.status).toBe("failed");
  });

  it("child with continueOnFailure: workflow continues but group still succeeds", async () => {
    const executed: string[] = [];
    const completed: unknown[] = [];
    bus.on("workflow.completed", (payload) => completed.push(payload));

    const definition = makeDefinition({
      steps: [
        {
          id: "parallel-work",
          type: "parallel",
          steps: [
            {
              id: "optional",
              type: "code",
              continueOnFailure: true,
              run: () => {
                throw new Error("non-critical");
              },
            },
            {
              id: "required",
              type: "code",
              run: () => "ok",
            },
          ],
        },
        {
          id: "next",
          type: "code",
          run: () => {
            executed.push("next");
            return "done";
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    await promise;

    expect(executed).toContain("next");
    expect((completed[0] as { status: string }).status).toBe("completed-with-warnings");
  });

  it("group with continueOnFailure: workflow continues with warnings when group fails", async () => {
    const executed: string[] = [];
    const completed: unknown[] = [];
    bus.on("workflow.completed", (payload) => completed.push(payload));

    const definition = makeDefinition({
      steps: [
        {
          id: "parallel-work",
          type: "parallel",
          continueOnFailure: true,
          steps: [
            {
              id: "failing-child",
              type: "code",
              run: () => {
                throw new Error("child failed");
              },
            },
          ],
        },
        {
          id: "next",
          type: "code",
          run: () => {
            executed.push("next");
            return "done";
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    await promise;

    expect(executed).toContain("next");
    expect((completed[0] as { status: string }).status).toBe("completed-with-warnings");
  });

  it("skips the entire parallel group when when-predicate is false", async () => {
    const executed: string[] = [];

    const definition = makeDefinition({
      steps: [
        {
          id: "parallel-work",
          type: "parallel",
          when: () => false,
          steps: [
            {
              id: "child-a",
              type: "code",
              run: () => {
                executed.push("child-a");
              },
            },
          ],
        },
        {
          id: "next",
          type: "code",
          run: (ctx) => {
            executed.push("next");
            return ctx.stepResults["parallel-work"]?.status;
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    const result = await promise;

    expect(executed).not.toContain("child-a");
    expect(executed).toContain("next");
    expect(result.metadata.status).toBe("success");
    const groupResult = result.metadata.steps[0];
    expect(groupResult.status).toBe("skipped");
  });

  it("child step stepResults are accessible to subsequent steps", async () => {
    let capturedResults: Record<string, unknown> = {};

    const definition = makeDefinition({
      steps: [
        {
          id: "parallel-fetch",
          type: "parallel",
          steps: [
            {
              id: "child-ok",
              type: "code",
              run: () => "value",
            },
            {
              id: "child-fail",
              type: "code",
              continueOnFailure: true,
              run: () => {
                throw new Error("oops");
              },
            },
          ],
        },
        {
          id: "inspect",
          type: "code",
          run: (ctx) => {
            capturedResults = { ...ctx.stepResults };
            return "done";
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    await promise;

    expect((capturedResults["child-ok"] as { status: string }).status).toBe("success");
    expect((capturedResults["child-fail"] as { status: string }).status).toBe("failed");
    expect((capturedResults["child-fail"] as { continueOnFailure: boolean }).continueOnFailure).toBe(true);
  });
});

describe("parallel step groups with agent steps", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  const SUCCESS_RESULT = {
    text: "done",
    streamedText: "",
    sessionId: "sess-1",
    turns: 1,
    totalCostUsd: 0.01,
    subtype: "success",
    isError: false,
  };

  function makeAgentStep(id: string, overrides: Partial<WorkflowAgentStep> = {}): WorkflowAgentStep {
    return {
      id,
      type: "agent",
      promptPath: "prompt.md",
      moduleRoot: projectDir,
      model: "claude-opus-4-7",
              effort: "xhigh",
      autonomyMode: "autonomous",
      harness: "claude-agent-sdk",
      ...overrides,
    };
  }

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-parallel-agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "prompt.md"), "# Prompt\nDo stuff.", "utf-8");
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("runs all agent steps concurrently and records outputs", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue({ ...SUCCESS_RESULT, text: "agent-done" });

    const definition = makeDefinition({
      steps: [
        {
          id: "parallel-agents",
          type: "parallel",
          steps: [makeAgentStep("agent-a"), makeAgentStep("agent-b")],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);

    const groupResult = result.metadata.steps[0];
    expect(groupResult.type).toBe("parallel");
    expect(groupResult.status).toBe("success");
    const inner = (groupResult.output as { steps: Array<{ id: string; status: string }> }).steps;
    expect(inner).toHaveLength(2);
    expect(inner.find((s) => s.id === "agent-a")?.status).toBe("success");
    expect(inner.find((s) => s.id === "agent-b")?.status).toBe("success");
  });

  it("marks group as failed when one agent step fails (without continueOnFailure)", async () => {
    mockedExecuteWithAgentSDK
      .mockResolvedValueOnce({ ...SUCCESS_RESULT, text: "agent-a-done" })
      .mockRejectedValueOnce(new Error("agent-b exploded"));

    const definition = makeDefinition({
      steps: [
        {
          id: "parallel-agents",
          type: "parallel",
          steps: [makeAgentStep("agent-a"), makeAgentStep("agent-b")],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    const inner = (
      result.metadata.steps[0].output as { steps: Array<{ id: string; status: string }> }
    ).steps;
    expect(inner.find((s) => s.id === "agent-a")?.status).toBe("success");
    expect(inner.find((s) => s.id === "agent-b")?.status).toBe("failed");
  });

  it("applies per-step timeout to agent steps in parallel group", async () => {
    // Agent step that never resolves — the timeout should kill it.
    mockedExecuteWithAgentSDK.mockImplementation(
      () => new Promise<never>(() => { /* hangs forever */ }),
    );

    const definition = makeDefinition({
      steps: [
        {
          id: "parallel-agents",
          type: "parallel",
          steps: [
            makeAgentStep("slow-agent", { timeoutMs: 50 }),
          ],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    const inner = (
      result.metadata.steps[0].output as { steps: Array<{ id: string; status: string; error?: string }> }
    ).steps;
    const slowResult = inner.find((s) => s.id === "slow-agent");
    expect(slowResult?.status).toBe("failed");
    expect(slowResult?.error).toMatch(/timed out/i);
  }, 5000);

  it("respects maxParallelAgents: limits concurrent agent executions", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    mockedExecuteWithAgentSDK.mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      concurrent--;
      return { ...SUCCESS_RESULT };
    });

    const definition = makeDefinition({
      steps: [
        {
          id: "parallel-agents",
          type: "parallel",
          maxParallelAgents: 2,
          steps: [
            makeAgentStep("agent-1"),
            makeAgentStep("agent-2"),
            makeAgentStep("agent-3"),
            makeAgentStep("agent-4"),
          ],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(4);
  }, 10000);
});
