import { describe, expect, it } from "vitest";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { WorkflowTestHarness } from "./index.js";

describe("WorkflowTestHarness — foreach step", () => {
  it("iterates over a single item and injects it via context.foreach", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "loop",
          type: "foreach",
          items: ["alpha"],
          as: "item",
          steps: [
            {
              id: "inner",
              type: "code",
              run: (ctx) => ctx.foreach?.item,
            },
          ],
        },
      ],
    };

    const harness = new WorkflowTestHarness(workflow);
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.loop.status).toBe("success");
    expect(result.steps.loop.output).toMatchObject({ items: 1, results: [{ index: 0, status: "success" }] });
    const innerStep = (result.steps.loop.output as { results: Array<{ steps: Record<string, unknown> }> }).results[0].steps;
    expect((innerStep.inner as { output: unknown }).output).toBe("alpha");
  });

  it("iterates over multiple items and binds each correctly", async () => {
    const collected: unknown[] = [];
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "loop",
          type: "foreach",
          items: [1, 2, 3],
          as: "n",
          steps: [
            {
              id: "collect",
              type: "code",
              run: (ctx) => {
                collected.push(ctx.foreach?.n);
                return ctx.foreach?.n;
              },
            },
          ],
        },
      ],
    };

    const harness = new WorkflowTestHarness(workflow);
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect((result.steps.loop.output as { items: number }).items).toBe(3);
    expect(collected).toEqual([1, 2, 3]);
  });

  it("resolves items from a function", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "loop",
          type: "foreach",
          items: async () => ["x", "y"],
          as: "val",
          steps: [
            {
              id: "inner",
              type: "code",
              run: (ctx) => String(ctx.foreach?.val),
            },
          ],
        },
      ],
    };

    const harness = new WorkflowTestHarness(workflow);
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect((result.steps.loop.output as { items: number }).items).toBe(2);
  });

  it("skips the foreach step when when predicate returns false", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "loop",
          type: "foreach",
          when: () => false,
          items: ["a"],
          as: "x",
          steps: [
            { id: "inner", type: "code", run: () => "should not run" },
          ],
        },
      ],
    };

    const harness = new WorkflowTestHarness(workflow);
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.loop.status).toBe("skipped");
  });

  it("fails the run when inner step fails and continueOnFailure is not set", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "loop",
          type: "foreach",
          items: ["a"],
          as: "x",
          steps: [
            {
              id: "inner",
              type: "code",
              run: () => { throw new Error("boom"); },
            },
          ],
        },
      ],
    };

    const harness = new WorkflowTestHarness(workflow);
    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps.loop.status).toBe("failed");
    const itemSteps = (result.steps.loop.output as { results: Array<{ steps: Record<string, unknown> }> }).results[0].steps;
    expect((itemSteps.inner as { status: string }).status).toBe("failed");
  });

  it("continues across iterations when continueOnFailure is set", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "loop",
          type: "foreach",
          items: ["a", "b"],
          as: "x",
          continueOnFailure: true,
          steps: [
            {
              id: "inner",
              type: "code",
              run: (ctx) => {
                if (ctx.foreach?.x === "a") throw new Error("first fails");
                return "ok";
              },
            },
          ],
        },
        { id: "after", type: "code", run: () => "reached" },
      ],
    };

    const harness = new WorkflowTestHarness(workflow);
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.loop.status).toBe("failed");
    const foreachOutput = result.steps.loop.output as { results: Array<{ index: number; status: string }> };
    expect(foreachOutput.results[0].status).toBe("failed");
    expect(foreachOutput.results[1].status).toBe("success");
    expect(result.steps.after.status).toBe("success");
  });

  it("handles an empty items array", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "loop",
          type: "foreach",
          items: [],
          as: "x",
          steps: [
            { id: "inner", type: "code", run: () => "unreachable" },
          ],
        },
      ],
    };

    const harness = new WorkflowTestHarness(workflow);
    const result = await harness.run();

    expect(result.status).toBe("success");
    expect((result.steps.loop.output as { items: number }).items).toBe(0);
    expect((result.steps.loop.output as { results: unknown[] }).results).toHaveLength(0);
  });
});
