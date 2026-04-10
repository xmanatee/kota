import { describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "../../workflow-testing/index.js";
import type { WorkflowBranchStepInput, WorkflowDefinitionInput } from "./types.js";
import { validateWorkflowDefinitions } from "./validation.js";

function makeWorkflow(steps: WorkflowDefinitionInput["steps"]): WorkflowDefinitionInput {
  return {
    name: "test",
    triggers: [{ event: "runtime.idle" }],
    steps,
  };
}

describe("branch step – WorkflowTestHarness", () => {
  it("runs ifTrue steps when condition is true", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        {
          id: "my-branch",
          type: "branch",
          condition: () => true,
          ifTrue: [
            { id: "true-step", type: "code", run: () => "true-output" },
          ],
          ifFalse: [
            { id: "false-step", type: "code", run: () => "false-output" },
          ],
        } satisfies WorkflowBranchStepInput,
      ]),
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps["my-branch"].status).toBe("success");
    expect(result.steps["my-branch"].output).toMatchObject({ arm: "ifTrue" });
    expect(result.steps["true-step"].status).toBe("success");
    expect(result.steps["true-step"].output).toBe("true-output");
    expect(result.steps["false-step"].status).toBe("skipped");
  });

  it("runs ifFalse steps when condition is false", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        {
          id: "my-branch",
          type: "branch",
          condition: () => false,
          ifTrue: [
            { id: "true-step", type: "code", run: () => "true-output" },
          ],
          ifFalse: [
            { id: "false-step", type: "code", run: () => "false-output" },
          ],
        } satisfies WorkflowBranchStepInput,
      ]),
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps["my-branch"].output).toMatchObject({ arm: "ifFalse" });
    expect(result.steps["false-step"].status).toBe("success");
    expect(result.steps["true-step"].status).toBe("skipped");
  });

  it("succeeds with no-op when ifFalse is omitted and condition is false", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        {
          id: "my-branch",
          type: "branch",
          condition: () => false,
          ifTrue: [
            { id: "true-step", type: "code", run: () => "true-output" },
          ],
        } satisfies WorkflowBranchStepInput,
      ]),
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps["my-branch"].status).toBe("success");
    expect(result.steps["my-branch"].output).toMatchObject({ arm: "ifFalse", steps: 0 });
    expect(result.steps["true-step"].status).toBe("skipped");
  });

  it("skips branch when outer when predicate returns false", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        {
          id: "my-branch",
          type: "branch",
          when: () => false,
          condition: () => true,
          ifTrue: [{ id: "true-step", type: "code", run: () => "x" }],
        } satisfies WorkflowBranchStepInput,
      ]),
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps["my-branch"].status).toBe("skipped");
    expect(result.steps["true-step"]).toBeUndefined();
  });

  it("propagates condition error as step failure", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        {
          id: "my-branch",
          type: "branch",
          condition: () => { throw new Error("boom"); },
          ifTrue: [{ id: "true-step", type: "code", run: () => "x" }],
          continueOnFailure: true,
        } satisfies WorkflowBranchStepInput,
      ]),
    );
    const result = await harness.run();
    expect(result.status).toBe("success"); // continueOnFailure
    expect(result.steps["my-branch"].status).toBe("failed");
  });

  it("supports nested branch steps", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        {
          id: "outer",
          type: "branch",
          condition: () => true,
          ifTrue: [
            {
              id: "inner",
              type: "branch",
              condition: () => false,
              ifTrue: [{ id: "inner-true", type: "code", run: () => "a" }],
              ifFalse: [{ id: "inner-false", type: "code", run: () => "b" }],
            } satisfies WorkflowBranchStepInput,
          ],
          ifFalse: [{ id: "outer-false", type: "code", run: () => "c" }],
        } satisfies WorkflowBranchStepInput,
      ]),
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps.outer.output).toMatchObject({ arm: "ifTrue" });
    expect(result.steps.inner.output).toMatchObject({ arm: "ifFalse" });
    expect(result.steps["inner-false"].output).toBe("b");
    expect(result.steps["inner-true"].status).toBe("skipped");
    expect(result.steps["outer-false"].status).toBe("skipped");
  });

  it("downstream steps can access branch arm step outputs", async () => {
    let capturedOutput: unknown;
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        {
          id: "branch",
          type: "branch",
          condition: () => true,
          ifTrue: [
            { id: "arm-step", type: "code", run: () => ({ value: 42 }) },
          ],
        } satisfies WorkflowBranchStepInput,
        {
          id: "downstream",
          type: "code",
          run: (ctx) => {
            capturedOutput = ctx.stepOutputs["arm-step"];
            return "done";
          },
        },
      ]),
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(capturedOutput).toEqual({ value: 42 });
  });
});

describe("branch step – validation", () => {
  it("accepts valid branch step", () => {
    const defs = validateWorkflowDefinitions([
      {
        definitionPath: "test.ts",
        name: "test",
        triggers: [{ event: "runtime.idle" }],
        steps: [
          {
            id: "b",
            type: "branch",
            condition: () => true,
            ifTrue: [{ id: "bt", type: "code", run: () => "x" }],
          } satisfies WorkflowBranchStepInput,
        ],
      },
    ]);
    expect(defs[0].steps[0].type).toBe("branch");
  });

  it("rejects missing condition", () => {
    expect(() =>
      validateWorkflowDefinitions([
        {
          definitionPath: "test.ts",
          name: "test",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "b",
              type: "branch",
              condition: "not-a-function" as unknown as () => boolean,
              ifTrue: [{ id: "bt", type: "code", run: () => "x" }],
            } satisfies WorkflowBranchStepInput,
          ],
        },
      ]),
    ).toThrow("condition must be a function");
  });

  it("rejects empty ifTrue", () => {
    expect(() =>
      validateWorkflowDefinitions([
        {
          definitionPath: "test.ts",
          name: "test",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "b",
              type: "branch",
              condition: () => true,
              ifTrue: [],
            } satisfies WorkflowBranchStepInput,
          ],
        },
      ]),
    ).toThrow("ifTrue must be a non-empty array");
  });

  it("rejects duplicate step IDs in branch arms", () => {
    expect(() =>
      validateWorkflowDefinitions([
        {
          definitionPath: "test.ts",
          name: "test",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "b",
              type: "branch",
              condition: () => true,
              ifTrue: [{ id: "dup", type: "code", run: () => "x" }],
              ifFalse: [{ id: "dup", type: "code", run: () => "y" }],
            } satisfies WorkflowBranchStepInput,
          ],
        },
      ]),
    ).toThrow('duplicate step id "dup"');
  });

  it("rejects restart steps inside branch arms", () => {
    expect(() =>
      validateWorkflowDefinitions([
        {
          definitionPath: "test.ts",
          name: "test",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "b",
              type: "branch",
              condition: () => true,
              ifTrue: [{ id: "verify", type: "code", run: () => "x" }],
              ifFalse: [{ id: "r", type: "restart", requires: ["verify"] }],
            } satisfies WorkflowBranchStepInput,
          ],
        },
      ]),
    ).toThrow("restart steps are not allowed inside branch arms");
  });
});
