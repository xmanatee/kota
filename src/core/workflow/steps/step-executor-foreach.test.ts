import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type {
  AgentHarness,
  AgentHarnessResult,
} from "#core/agent-harness/types.js";
import { EventBus } from "#core/events/event-bus.js";
import { executeWorkflowRun } from "../run-executor.js";
import { WorkflowRunStore } from "../run-store.js";
import type { WorkflowForeachStepInput } from "../step-input-control-flow.js";
import type { WorkflowAgentStep } from "../step-types.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import type { WorkflowDefinition } from "../types.js";
import { validateWorkflowDefinitions } from "../validation.js";

function makeRetryTrigger(retryOf: string): WorkflowRunTrigger {
  return { event: "retry", payload: { retryOf, triggeredAt: new Date().toISOString() } };
}

function makeDefinition(
  steps: WorkflowDefinition["steps"],
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    recoveryCapable: false,
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [],
    steps,
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", payload: {} };

const AGENT_OK_RESULT: AgentHarnessResult = {
  text: "done",
  streamedText: "done",
  turns: 1,
  isError: false,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueHarnessName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function registerWorkflowTestHarness(
  name: string,
  run: AgentHarness["run"],
): void {
  registerAgentHarness({
    name,
    description: "foreach workflow test harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    run,
  });
}

function makeAgentStep(
  projectDir: string,
  harness: string,
  overrides: Partial<WorkflowAgentStep> = {},
): WorkflowAgentStep {
  writeFileSync(join(projectDir, "prompt.md"), "# Prompt\nRun the item.\n", "utf-8");
  return {
    id: "agent-process",
    type: "agent",
    promptPath: "prompt.md",
    moduleRoot: projectDir,
    harness,
    model: "test-model",
    effort: "low",
    autonomyMode: "autonomous",
    ...overrides,
  };
}

describe("foreach step – executor", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-foreach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("runs inner steps for each item in sequence and records output", async () => {
    const processed: unknown[] = [];

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        items: () => ["a", "b", "c"],
        as: "item",
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              processed.push(ctx.foreach?.item);
              return `processed:${String(ctx.foreach?.item)}`;
            },
          },
        ],
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(processed).toEqual(["a", "b", "c"]);

    const groupResult = result.metadata.steps[0];
    expect(groupResult.id).toBe("iterate");
    expect(groupResult.type).toBe("foreach");
    expect(groupResult.status).toBe("success");

    const output = groupResult.output as { items: number; results: Array<{ index: number; status: string }> };
    expect(output.items).toBe(3);
    expect(output.results).toHaveLength(3);
    expect(output.results[0].status).toBe("success");
    expect(output.results[1].status).toBe("success");
    expect(output.results[2].status).toBe("success");
  });

  it("is a no-op for an empty list", async () => {
    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        items: () => [],
        as: "item",
        steps: [
          {
            id: "process",
            type: "code",
            run: () => "should not run",
          },
        ],
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    const output = result.metadata.steps[0].output as { items: number; results: unknown[] };
    expect(output.items).toBe(0);
    expect(output.results).toHaveLength(0);
  });

  it("fails on first item failure when continueOnFailure is false", async () => {
    const processed: number[] = [];

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        items: () => [0, 1, 2],
        as: "idx",
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              const idx = ctx.foreach?.idx as number;
              processed.push(idx);
              if (idx === 1) throw new Error("item 1 failed");
              return `ok:${idx}`;
            },
          },
        ],
      },
      {
        id: "after",
        type: "code",
        run: () => "after",
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    // Only items 0 and 1 were processed; item 2 was not reached
    expect(processed).toEqual([0, 1]);
    // "after" step should not have run
    const afterStep = result.metadata.steps.find((s) => s.id === "after");
    expect(afterStep).toBeUndefined();
  });

  it("continues past item failures when continueOnFailure is true", async () => {
    const processed: number[] = [];
    const afterRan: string[] = [];

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        continueOnFailure: true,
        items: () => [0, 1, 2],
        as: "idx",
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              const idx = ctx.foreach?.idx as number;
              processed.push(idx);
              if (idx === 1) throw new Error("item 1 failed");
              return `ok:${idx}`;
            },
          },
        ],
      },
      {
        id: "after",
        type: "code",
        run: () => {
          afterRan.push("ran");
          return "done";
        },
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    // Workflow continues but has warnings
    expect(result.metadata.status).toBe("completed-with-warnings");
    // All items processed
    expect(processed).toEqual([0, 1, 2]);
    // "after" step ran
    expect(afterRan).toEqual(["ran"]);

    const groupResult = result.metadata.steps[0];
    expect(groupResult.status).toBe("failed");
    expect(groupResult.continueOnFailure).toBe(true);
    const output = groupResult.output as { items: number; results: Array<{ index: number; status: string }> };
    expect(output.items).toBe(3);
    expect(output.results[0].status).toBe("success");
    expect(output.results[1].status).toBe("failed");
    expect(output.results[2].status).toBe("success");
  });

  it("skips the foreach step when outer when predicate returns false", async () => {
    const processed: unknown[] = [];

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        when: () => false,
        items: () => ["a", "b"],
        as: "item",
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              processed.push(ctx.foreach?.item);
              return "done";
            },
          },
        ],
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(processed).toHaveLength(0);
    expect(result.metadata.steps[0].status).toBe("skipped");
  });

  it("exposes the current item via ctx.foreach and runs multiple inner steps per item", async () => {
    const log1: unknown[] = [];
    const log2: unknown[] = [];

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        items: () => [10, 20],
        as: "n",
        steps: [
          {
            id: "step-a",
            type: "code",
            run: (ctx) => {
              log1.push(ctx.foreach?.n);
              return `a:${String(ctx.foreach?.n)}`;
            },
          },
          {
            id: "step-b",
            type: "code",
            run: (ctx) => {
              log2.push(ctx.foreach?.n);
              return `b:${String(ctx.foreach?.n)}`;
            },
          },
        ],
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(log1).toEqual([10, 20]);
    expect(log2).toEqual([10, 20]);
  });

  it("downstream steps can access the last iteration output via stepOutputs", async () => {
    let capturedOutput: unknown;

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        items: () => [1, 2, 3],
        as: "n",
        steps: [
          {
            id: "compute",
            type: "code",
            run: (ctx) => ({ value: ctx.foreach?.n }),
          },
        ],
      },
      {
        id: "downstream",
        type: "code",
        run: (ctx) => {
          capturedOutput = ctx.stepOutputs.compute;
          return "done";
        },
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    // Last iteration output is accessible
    expect(capturedOutput).toEqual({ value: 3 });
  });
});

describe("foreach step – maxConcurrency", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-foreach-conc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("runs items concurrently up to maxConcurrency and preserves result order", async () => {
    const order: number[] = [];
    // Stagger completions: item 0 resolves later than item 1 via async yielding
    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        maxConcurrency: 3,
        items: () => [0, 1, 2],
        as: "n",
        steps: [
          {
            id: "process",
            type: "code",
            run: async (ctx) => {
              const n = ctx.foreach?.n as number;
              // yield to event loop so items interleave
              await new Promise((r) => setTimeout(r, n === 0 ? 10 : 0));
              order.push(n);
              return `result:${n}`;
            },
          },
        ],
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    // All items processed
    expect(order.sort()).toEqual([0, 1, 2]);

    const groupResult = result.metadata.steps[0];
    expect(groupResult.status).toBe("success");
    const output = groupResult.output as { items: number; results: Array<{ index: number; status: string }> };
    expect(output.items).toBe(3);
    // Results are in item-index order regardless of completion order
    expect(output.results[0].index).toBe(0);
    expect(output.results[1].index).toBe(1);
    expect(output.results[2].index).toBe(2);
    expect(output.results.every((r) => r.status === "success")).toBe(true);
  });

  it("stops after the failing batch when continueOnFailure is false", async () => {
    const processed: number[] = [];

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        maxConcurrency: 2,
        items: () => [0, 1, 2, 3],
        as: "n",
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              const n = ctx.foreach?.n as number;
              processed.push(n);
              if (n === 1) throw new Error("item 1 failed");
              return `ok:${n}`;
            },
          },
        ],
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    // First batch [0, 1] completes; second batch [2, 3] is skipped
    expect(processed).toEqual(expect.arrayContaining([0, 1]));
    expect(processed).not.toContain(2);
    expect(processed).not.toContain(3);
  });

  it("processes all items when continueOnFailure is true", async () => {
    const processed: number[] = [];

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        maxConcurrency: 2,
        continueOnFailure: true,
        items: () => [0, 1, 2, 3],
        as: "n",
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              const n = ctx.foreach?.n as number;
              processed.push(n);
              if (n === 1) throw new Error("item 1 failed");
              return `ok:${n}`;
            },
          },
        ],
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("completed-with-warnings");
    expect(processed.sort()).toEqual([0, 1, 2, 3]);
  });

  it("runs agent iterations concurrently up to foreach and agent caps", async () => {
    const harness = uniqueHarnessName("foreach-agent-cap");
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    registerWorkflowTestHarness(harness, async () => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active--;
      return { ...AGENT_OK_RESULT };
    });

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        maxConcurrency: 3,
        items: () => [0, 1, 2, 3],
        as: "n",
        steps: [makeAgentStep(projectDir, harness)],
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
      agentConcurrency: 2,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(calls).toBe(4);
    expect(maxActive).toBe(2);
  });

  it("serializes agent iterations when agentConcurrency is 1", async () => {
    const harness = uniqueHarnessName("foreach-agent-serial");
    let active = 0;
    let maxActive = 0;
    registerWorkflowTestHarness(harness, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      active--;
      return { ...AGENT_OK_RESULT };
    });

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        maxConcurrency: 3,
        items: () => [0, 1, 2],
        as: "n",
        steps: [makeAgentStep(projectDir, harness)],
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
      agentConcurrency: 1,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(maxActive).toBe(1);
  });

  it("serializes repair-loop agent iterations through agentConcurrency", async () => {
    const harness = uniqueHarnessName("foreach-agent-repair-serial");
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    registerWorkflowTestHarness(harness, async (options) => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        const isRepair = options.prompt.includes("Post-check repair attempt");
        await delay(isRepair ? 30 : 20);
        return { ...AGENT_OK_RESULT, text: isRepair ? "repaired" : "initial" };
      } finally {
        active--;
      }
    });
    const checkCounts = new Map<unknown, number>();

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        maxConcurrency: 2,
        items: () => [0, 1],
        as: "n",
        steps: [
          makeAgentStep(projectDir, harness, {
            repairLoop: {
              maxRepairAttempts: 1,
              checks: [
                {
                  id: "needs-repair",
                  type: "code",
                  run: (context) => {
                    const key = context.foreach?.n;
                    const count = checkCounts.get(key) ?? 0;
                    checkCounts.set(key, count + 1);
                    if (count === 0) throw new Error(`item ${String(key)} needs repair`);
                    return "ok";
                  },
                },
              ],
            },
          }),
        ],
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
      agentConcurrency: 1,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(calls).toBe(4);
    expect([...checkCounts.values()]).toEqual([2, 2]);
    expect(maxActive).toBe(1);
  });

  it("preserves ordered agent item results and continues after agent item failures", async () => {
    const harness = uniqueHarnessName("foreach-agent-failure");
    let nextCallIndex = 0;
    registerWorkflowTestHarness(harness, async () => {
      const callIndex = nextCallIndex++;
      await delay(callIndex === 0 ? 20 : 0);
      if (callIndex === 1) throw new Error("agent item 1 failed");
      return { ...AGENT_OK_RESULT, text: `call:${callIndex}` };
    });

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        maxConcurrency: 3,
        continueOnFailure: true,
        items: () => [0, 1, 2],
        as: "n",
        steps: [makeAgentStep(projectDir, harness)],
      },
    ]);

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
      agentConcurrency: 3,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("completed-with-warnings");
    const output = result.metadata.steps[0].output as {
      results: Array<{
        index: number;
        status: string;
        steps: Record<string, { status: string; output?: { content?: string } }>;
      }>;
    };
    expect(output.results.map((item) => item.index)).toEqual([0, 1, 2]);
    expect(output.results.map((item) => item.status)).toEqual([
      "success",
      "failed",
      "success",
    ]);
    expect(output.results[0].steps["agent-process"]?.output?.content).toBe("call:0");
    expect(output.results[2].steps["agent-process"]?.output?.content).toBe("call:2");
  });

  it("re-runs only failed agent items on retry when retryFailedItems is true", async () => {
    const harness = uniqueHarnessName("foreach-agent-retry");
    let nextCallIndex = 0;
    registerWorkflowTestHarness(harness, async () => {
      const callIndex = nextCallIndex++;
      if (callIndex === 1) throw new Error("agent item 1 failed");
      return { ...AGENT_OK_RESULT, text: `first:${callIndex}` };
    });

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        maxConcurrency: 3,
        continueOnFailure: true,
        retryFailedItems: true,
        items: () => [0, 1, 2],
        as: "n",
        steps: [makeAgentStep(projectDir, harness)],
      },
    ]);

    const { promise: firstRun } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
      agentConcurrency: 3,
    });
    const first = await firstRun;
    expect(first.metadata.status).toBe("completed-with-warnings");

    let retryCalls = 0;
    registerWorkflowTestHarness(harness, async () => {
      const callIndex = retryCalls++;
      return { ...AGENT_OK_RESULT, text: `retry:${callIndex}` };
    });

    const { promise: retryRun } = executeWorkflowRun(
      definition,
      makeRetryTrigger(first.metadata.id),
      {
        projectDir,
        bus,
        store,
        log,
        agentConcurrency: 3,
      },
    );
    const retried = await retryRun;

    expect(retryCalls).toBe(1);
    expect(retried.metadata.status).toBe("success");
    const output = retried.metadata.steps[0].output as {
      results: Array<{
        status: string;
        steps: Record<string, { output?: { content?: string } }>;
      }>;
    };
    expect(output.results.map((item) => item.status)).toEqual([
      "success",
      "success",
      "success",
    ]);
    expect(output.results[0].steps["agent-process"]?.output?.content).toBe("first:0");
    expect(output.results[1].steps["agent-process"]?.output?.content).toBe("retry:0");
    expect(output.results[2].steps["agent-process"]?.output?.content).toBe("first:2");
  });
});

describe("foreach step – validation", () => {
  function makeInput(steps: WorkflowForeachStepInput["steps"] = [{ id: "s", type: "code", run: () => 1 }]) {
    return validateWorkflowDefinitions([
      {
        definitionPath: "test.ts",
        name: "test",
        triggers: [{ event: "runtime.idle" }],
        steps: [
          {
            id: "loop",
            type: "foreach",
            items: () => [],
            as: "item",
            steps,
          } satisfies WorkflowForeachStepInput,
        ],
      },
    ]);
  }

  it("accepts a valid foreach step", () => {
    const defs = makeInput();
    expect(defs[0].steps[0].type).toBe("foreach");
  });

  it("rejects missing items", () => {
    expect(() =>
      validateWorkflowDefinitions([
        {
          definitionPath: "test.ts",
          name: "test",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "loop",
              type: "foreach",
              items: undefined as unknown as () => [],
              as: "item",
              steps: [{ id: "s", type: "code", run: () => 1 }],
            } satisfies WorkflowForeachStepInput,
          ],
        },
      ]),
    ).toThrow("items is required");
  });

  it("rejects non-function non-array items", () => {
    expect(() =>
      validateWorkflowDefinitions([
        {
          definitionPath: "test.ts",
          name: "test",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "loop",
              type: "foreach",
              items: "not-valid" as unknown as () => [],
              as: "item",
              steps: [{ id: "s", type: "code", run: () => 1 }],
            } satisfies WorkflowForeachStepInput,
          ],
        },
      ]),
    ).toThrow("items must be a function or array");
  });

  it("rejects empty steps array", () => {
    expect(() => makeInput([])).toThrow("steps must be a non-empty array");
  });

  it("rejects unsupported inner step types", () => {
    expect(() =>
      validateWorkflowDefinitions([
        {
          definitionPath: "test.ts",
          name: "test",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "loop",
              type: "foreach",
              items: () => [],
              as: "item",
              steps: [
                {
                  id: "inner-emit",
                  type: "emit",
                  event: "some.event",
                } as unknown as { id: string; type: "code"; run: () => void },
              ],
            } satisfies WorkflowForeachStepInput,
          ],
        },
      ]),
    ).toThrow(/must be "code" or "agent"/);
  });

  it("accepts maxConcurrency: 1", () => {
    const defs = validateWorkflowDefinitions([
      {
        definitionPath: "test.ts",
        name: "test",
        triggers: [{ event: "runtime.idle" }],
        steps: [
          {
            id: "loop",
            type: "foreach",
            maxConcurrency: 1,
            items: () => [],
            as: "item",
            steps: [{ id: "s", type: "code", run: () => 1 }],
          } satisfies WorkflowForeachStepInput,
        ],
      },
    ]);
    expect((defs[0].steps[0] as { maxConcurrency?: number }).maxConcurrency).toBe(1);
  });

  it("accepts maxConcurrency > 1 with agent inner steps", () => {
    const validationProjectDir = join(
      tmpdir(),
      `kota-foreach-validation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(validationProjectDir, { recursive: true });
    writeFileSync(join(validationProjectDir, "prompt.md"), "# Prompt\nRun.\n", "utf-8");
    try {
      const defs = validateWorkflowDefinitions(
        [
          {
            definitionPath: "test.ts",
            name: "test",
            triggers: [{ event: "runtime.idle" }],
            steps: [
              {
                id: "loop",
                type: "foreach",
                maxConcurrency: 2,
                items: () => [],
                as: "item",
                steps: [
                  {
                    id: "agent-step",
                    type: "agent",
                    promptPath: "prompt.md",
                    harness: "foreach-validation-harness",
                    model: "test-model",
                    effort: "low",
                    autonomyMode: "autonomous",
                  },
                ],
              } satisfies WorkflowForeachStepInput,
            ],
          },
        ],
        validationProjectDir,
      );
      expect((defs[0].steps[0] as { maxConcurrency?: number }).maxConcurrency).toBe(2);
    } finally {
      rmSync(validationProjectDir, { recursive: true, force: true });
    }
  });

  it("rejects unsupported inner step types even when maxConcurrency > 1", () => {
    expect(() =>
      validateWorkflowDefinitions([
        {
          definitionPath: "test.ts",
          name: "test",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "loop",
              type: "foreach",
              maxConcurrency: 2,
              items: () => [],
              as: "item",
              steps: [
                {
                  id: "inner-trigger",
                  type: "trigger",
                  workflow: "other",
                } as unknown as { id: string; type: "code"; run: () => void },
              ],
            } satisfies WorkflowForeachStepInput,
          ],
        },
      ]),
    ).toThrow(/must be "code" or "agent"/);
  });

  it("rejects non-integer maxConcurrency", () => {
    expect(() =>
      validateWorkflowDefinitions([
        {
          definitionPath: "test.ts",
          name: "test",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "loop",
              type: "foreach",
              maxConcurrency: 1.5 as unknown as number,
              items: () => [],
              as: "item",
              steps: [{ id: "s", type: "code", run: () => 1 }],
            } satisfies WorkflowForeachStepInput,
          ],
        },
      ]),
    ).toThrow(/maxConcurrency must be an integer/);
  });

  it("rejects duplicate step IDs between foreach inner steps and outer steps", () => {
    expect(() =>
      validateWorkflowDefinitions([
        {
          definitionPath: "test.ts",
          name: "test",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "loop",
              type: "foreach",
              items: () => [],
              as: "item",
              steps: [{ id: "dup", type: "code", run: () => 1 }],
            } satisfies WorkflowForeachStepInput,
            { id: "dup", type: "code", run: () => 2 },
          ],
        },
      ]),
    ).toThrow('duplicate step id "dup"');
  });
});

describe("foreach step – retryFailedItems partial-resume", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-foreach-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("re-runs only failed items on retry when retryFailedItems is true", async () => {
    const processed: number[] = [];

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        continueOnFailure: true,
        retryFailedItems: true,
        items: () => [0, 1, 2],
        as: "idx",
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              const idx = ctx.foreach?.idx as number;
              processed.push(idx);
              if (idx === 1) throw new Error("item 1 failed");
              return `ok:${idx}`;
            },
          },
        ],
      },
    ]);

    // First run: items 0 and 2 succeed, item 1 fails
    const { promise: p1 } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const first = await p1;
    expect(first.metadata.status).toBe("completed-with-warnings");
    const firstId = first.metadata.id;
    processed.length = 0;

    // Retry: item 1 is fixed — should only re-run item 1
    const fixedDefinition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        continueOnFailure: true,
        retryFailedItems: true,
        items: () => [0, 1, 2],
        as: "idx",
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              const idx = ctx.foreach?.idx as number;
              processed.push(idx);
              return `ok:${idx}`;
            },
          },
        ],
      },
    ]);

    const { promise: p2 } = executeWorkflowRun(fixedDefinition, makeRetryTrigger(firstId), { projectDir, bus, store, log });
    const retried = await p2;

    // Only item 1 should have been re-run
    expect(processed).toEqual([1]);
    expect(retried.metadata.status).toBe("success");

    const foreachResult = retried.metadata.steps.find((s) => s.id === "iterate");
    expect(foreachResult?.status).toBe("success");
    const output = foreachResult?.output as { items: number; results: Array<{ index: number; status: string }> };
    expect(output.items).toBe(3);
    expect(output.results).toHaveLength(3);
    expect(output.results[0].status).toBe("success");
    expect(output.results[1].status).toBe("success"); // re-run and now succeeds
    expect(output.results[2].status).toBe("success");
  });

  it("falls back to a full re-run when item count changes between runs", async () => {
    const processed: number[] = [];

    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        continueOnFailure: true,
        retryFailedItems: true,
        items: () => [0, 1],
        as: "idx",
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              const idx = ctx.foreach?.idx as number;
              processed.push(idx);
              if (idx === 1) throw new Error("item 1 failed");
              return `ok:${idx}`;
            },
          },
        ],
      },
    ]);

    const { promise: p1 } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const first = await p1;
    const firstId = first.metadata.id;
    processed.length = 0;

    // Retry with MORE items — count mismatch triggers full re-run
    const expandedDefinition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        continueOnFailure: true,
        retryFailedItems: true,
        items: () => [0, 1, 2], // 3 items now
        as: "idx",
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              const idx = ctx.foreach?.idx as number;
              processed.push(idx);
              return `ok:${idx}`;
            },
          },
        ],
      },
    ]);

    const { promise: p2 } = executeWorkflowRun(expandedDefinition, makeRetryTrigger(firstId), { projectDir, bus, store, log });
    await p2;

    // All 3 items run (full re-run due to count mismatch)
    expect(processed.sort()).toEqual([0, 1, 2]);
  });

  it("does not activate partial-resume when retryFailedItems is absent", async () => {
    const processed: number[] = [];

    // A foreach WITHOUT retryFailedItems but WITH continueOnFailure.
    // On retry the foreach step is NOT treated as a retry point, so it is
    // replayed from the prior run result without re-running any items.
    const definition = makeDefinition([
      {
        id: "iterate",
        type: "foreach",
        continueOnFailure: true,
        // no retryFailedItems
        items: () => [0, 1, 2],
        as: "idx",
        steps: [
          {
            id: "process",
            type: "code",
            run: (ctx) => {
              const idx = ctx.foreach?.idx as number;
              processed.push(idx);
              if (idx === 1) throw new Error("item 1 failed");
              return `ok:${idx}`;
            },
          },
        ],
      },
      {
        id: "after",
        type: "code",
        run: () => "after",
      },
    ]);

    const { promise: p1 } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const first = await p1;
    expect(first.metadata.status).toBe("completed-with-warnings");
    const firstId = first.metadata.id;
    processed.length = 0;

    // Retry: the foreach step is replayed (not re-run). The "after" step is the retry point
    // because findRetryFromIndex skips continueOnFailure failures without retryFailedItems.
    // However, "after" succeeded in the first run, so retryFromIndex goes past it too —
    // the whole workflow is considered fully complete and retryFromIndex = steps.length.
    const { promise: p2 } = executeWorkflowRun(definition, makeRetryTrigger(firstId), { projectDir, bus, store, log });
    const retried = await p2;

    // No items were processed — the foreach was not re-run
    expect(processed).toEqual([]);
    // The retry run has both steps replayed
    expect(retried.metadata.steps).toHaveLength(2);
  });
});
