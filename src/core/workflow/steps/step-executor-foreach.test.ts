import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import {
  AGENT_OK_RESULT,
  createRunExecutorTestFixture,
  makeAgentStep,
  makeDefinition,
  type RunExecutorTestFixture,
  registerWorkflowScenarioDriver,
} from "../run-executor-test-fixture.js";
import type { WorkflowForeachStepInput } from "../step-input-control-flow.js";
import type { WorkflowRunTrigger } from "../trigger-types.js";
import { validateWorkflowDefinitions } from "../validation.js";

function retryTrigger(retryOf: string): WorkflowRunTrigger {
  return {
    event: "runtime.idle",
    schemaRef: null,
    payload: { retryOf, triggeredAt: new Date().toISOString() },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("foreach execution", () => {
  let fixture: RunExecutorTestFixture;

  beforeEach(() => {
    fixture = createRunExecutorTestFixture();
  });

  afterEach(() => {
    fixture.dispose();
  });

  it("exposes each item, preserves ordered results, and publishes the last inner output", async () => {
    const processed: string[] = [];
    let downstream: unknown;
    const result = await fixture.execute(
      makeDefinition({
        steps: [
          {
            id: "iterate",
            type: "foreach",
            items: ["a", "b", "c"],
            as: "item",
            steps: [
              {
                id: "process",
                type: "code",
                run: (ctx) => {
                  const item = String(ctx.foreach?.item);
                  processed.push(item);
                  return { item };
                },
              },
            ],
          },
          {
            id: "observe",
            type: "code",
            run: (ctx) => {
              downstream = ctx.stepOutputs.process;
              return downstream;
            },
          },
        ],
      }),
    ).promise;

    expect(result.metadata.status).toBe("success");
    expect(processed).toEqual(["a", "b", "c"]);
    expect(downstream).toEqual({ item: "c" });
    expect(result.metadata.steps[0]?.output).toMatchObject({
      items: 3,
      results: [
        { index: 0, status: "success" },
        { index: 1, status: "success" },
        { index: 2, status: "success" },
      ],
    });
  });

  it.each([
    {
      continueOnFailure: false,
      expectedStatus: "failed",
      expectedProcessed: [0, 1],
    },
    {
      continueOnFailure: true,
      expectedStatus: "completed-with-warnings",
      expectedProcessed: [0, 1, 2],
    },
  ])(
    "applies continueOnFailure=$continueOnFailure to remaining items and the durable outcome",
    async ({ continueOnFailure, expectedStatus, expectedProcessed }) => {
      const processed: number[] = [];
      const result = await fixture.execute(
        makeDefinition({
          steps: [
            {
              id: "iterate",
              type: "foreach",
              continueOnFailure,
              items: [0, 1, 2],
              as: "item",
              steps: [
                {
                  id: "process",
                  type: "code",
                  run: (ctx) => {
                    const item = ctx.foreach?.item as number;
                    processed.push(item);
                    if (item === 1) throw new Error("representative item failure");
                    return item;
                  },
                },
              ],
            },
          ],
        }),
      ).promise;

      expect(result.metadata.status).toBe(expectedStatus);
      expect(processed).toEqual(expectedProcessed);
    },
  );

  it("honors maxConcurrency while retaining item-index result order", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await fixture.execute(
      makeDefinition({
        steps: [
          {
            id: "iterate",
            type: "foreach",
            maxConcurrency: 2,
            items: [0, 1, 2, 3],
            as: "item",
            steps: [
              {
                id: "process",
                type: "code",
                run: async (ctx) => {
                  active += 1;
                  maxActive = Math.max(maxActive, active);
                  const item = ctx.foreach?.item as number;
                  await delay(item % 2 === 0 ? 15 : 1);
                  active -= 1;
                  return item;
                },
              },
            ],
          },
        ],
      }),
    ).promise;

    expect(result.metadata.status).toBe("success");
    expect(maxActive).toBe(2);
    const output = result.metadata.steps[0]?.output as {
      results: Array<{ index: number }>;
    };
    expect(output.results.map((item) => item.index)).toEqual([0, 1, 2, 3]);
  });

  it("keeps repair-loop agent attempts inside the foreach concurrency cap", async () => {
    const harness = `foreach-repair-${Date.now()}`;
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    registerWorkflowScenarioDriver(
      harness,
      async (_options: AgentHarnessRunOptions) => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await delay(10);
          return AGENT_OK_RESULT;
        } finally {
          active -= 1;
        }
      },
    );
    const checks = new Map<unknown, number>();
    const result = await fixture.execute(
      makeDefinition({
        moduleRoot: fixture.workspaceRoot,
        steps: [
          {
            id: "iterate",
            type: "foreach",
            maxConcurrency: 1,
            items: [0, 1],
            as: "item",
            steps: [
              makeAgentStep(fixture.workspaceRoot, harness, {
                repairLoop: {
                  maxRepairAttempts: 1,
                  checks: [
                    {
                      id: "needs-repair",
                      type: "code",
                      run: (ctx) => {
                        const item = ctx.foreach?.item;
                        const count = checks.get(item) ?? 0;
                        checks.set(item, count + 1);
                        if (count === 0) throw new Error("repair once");
                        return "ok";
                      },
                    },
                  ],
                },
              }),
            ],
          },
        ],
      }),
    ).promise;

    expect(result.metadata.status).toBe("success");
    expect(calls).toBe(4);
    expect(maxActive).toBe(1);
    expect([...checks.values()]).toEqual([2, 2]);
  });

  it("retries only failed items and merges their outputs with prior successes", async () => {
    const processed: number[] = [];
    const definition = makeDefinition({
      steps: [
        {
          id: "iterate",
          type: "foreach",
          continueOnFailure: true,
          retryFailedItems: true,
          items: [0, 1, 2],
          as: "item",
          steps: [
            {
              id: "process",
              type: "code",
              run: (ctx) => {
                const item = ctx.foreach?.item as number;
                processed.push(item);
                if (item === 1) throw new Error("first attempt fails");
                return `first:${item}`;
              },
            },
          ],
        },
      ],
    });
    const first = await fixture.execute(definition).promise;
    processed.length = 0;

    const fixed = makeDefinition({
      steps: [
        {
          id: "iterate",
          type: "foreach",
          continueOnFailure: true,
          retryFailedItems: true,
          items: [0, 1, 2],
          as: "item",
          steps: [
            {
              id: "process",
              type: "code",
              run: (ctx) => {
                const item = ctx.foreach?.item as number;
                processed.push(item);
                return `retry:${item}`;
              },
            },
          ],
        },
      ],
    });
    const retried = await fixture.execute(fixed, {
      trigger: retryTrigger(first.metadata.id),
    }).promise;

    expect(first.metadata.status).toBe("completed-with-warnings");
    expect(retried.metadata.status).toBe("success");
    expect(processed).toEqual([1]);
    expect(retried.metadata.steps[0]?.output).toMatchObject({
      results: [
        { index: 0, status: "success" },
        { index: 1, status: "success" },
        { index: 2, status: "success" },
      ],
    });
  });

  it("falls back to a full retry when the item set changes", async () => {
    const firstDefinition = makeDefinition({
      steps: [
        {
          id: "iterate",
          type: "foreach",
          continueOnFailure: true,
          retryFailedItems: true,
          items: [0, 1],
          as: "item",
          steps: [
            {
              id: "process",
              type: "code",
              run: (ctx) => {
                if (ctx.foreach?.item === 1) throw new Error("first attempt fails");
                return ctx.foreach?.item;
              },
            },
          ],
        },
      ],
    });
    const first = await fixture.execute(firstDefinition).promise;
    const processed: number[] = [];
    const expanded = makeDefinition({
      steps: [
        {
          id: "iterate",
          type: "foreach",
          continueOnFailure: true,
          retryFailedItems: true,
          items: [0, 1, 2],
          as: "item",
          steps: [
            {
              id: "process",
              type: "code",
              run: (ctx) => {
                const item = ctx.foreach?.item as number;
                processed.push(item);
                return item;
              },
            },
          ],
        },
      ],
    });

    await fixture.execute(expanded, {
      trigger: retryTrigger(first.metadata.id),
    }).promise;

    expect(processed).toEqual([0, 1, 2]);
  });
});

describe("foreach validation", () => {
  function validate(step: WorkflowForeachStepInput): void {
    validateWorkflowDefinitions([
      {
        repository: "read",
        definitionPath: "foreach-validation.test.ts",
        name: "foreach-validation",
        triggers: [{ event: "runtime.idle" }],
        steps: [step],
      },
    ]);
  }

  it("accepts concurrent agent items", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-foreach-validation-"));
    const promptPath = join(root, "prompt.md");
    writeFileSync(promptPath, "Run.\n", "utf8");
    try {
      expect(() =>
        validateWorkflowDefinitions(
          [
            {
              repository: "read",
              definitionPath: "foreach-validation.test.ts",
              moduleRoot: root,
              name: "foreach-validation",
              triggers: [{ event: "runtime.idle" }],
              steps: [
                {
                  id: "loop",
                  type: "foreach",
                  maxConcurrency: 2,
                  items: [],
                  as: "item",
                  steps: [
                    {
                      id: "agent",
                      type: "agent",
                      promptPath: "prompt.md",
                      harness: "test",
                      model: "test-model",
                      effort: "low",
                      autonomyMode: "autonomous",
                    },
                  ],
                },
              ],
            },
          ],
          root,
        )
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "missing items",
      step: {
        id: "loop",
        type: "foreach",
        items: undefined,
        as: "item",
        steps: [{ id: "inner", type: "code", run: () => null }],
      },
      error: "items is required",
    },
    {
      name: "non-collection items",
      step: {
        id: "loop",
        type: "foreach",
        items: "invalid",
        as: "item",
        steps: [{ id: "inner", type: "code", run: () => null }],
      },
      error: "items must be a function or array",
    },
    {
      name: "empty inner steps",
      step: { id: "loop", type: "foreach", items: [], as: "item", steps: [] },
      error: "steps must be a non-empty array",
    },
    {
      name: "unsupported inner step",
      step: {
        id: "loop",
        type: "foreach",
        items: [],
        as: "item",
        steps: [{ id: "inner", type: "emit", event: "example.event" }],
      },
      error: 'must be "code" or "agent"',
    },
    {
      name: "fractional concurrency",
      step: {
        id: "loop",
        type: "foreach",
        maxConcurrency: 1.5,
        items: [],
        as: "item",
        steps: [{ id: "inner", type: "code", run: () => null }],
      },
      error: "maxConcurrency must be an integer",
    },
  ])("rejects $name", ({ step, error }) => {
    expect(() => validate(step as WorkflowForeachStepInput)).toThrow(error);
  });
});
