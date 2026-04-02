import { describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "../workflow-testing/index.js";
import type { WorkflowApprovalStepInput, WorkflowDefinitionInput } from "./types.js";

function makeWorkflow(steps: WorkflowDefinitionInput["steps"]): WorkflowDefinitionInput {
  return {
    name: "test",
    triggers: [{ event: "runtime.idle" }],
    steps,
  };
}

describe("approval step – WorkflowTestHarness", () => {
  it("approves by default when no mock is provided", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        { id: "confirm", type: "approval", reason: "Deploy to prod?" } satisfies WorkflowApprovalStepInput,
      ]),
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps["confirm"].status).toBe("success");
    expect(result.steps["confirm"].output).toMatchObject({ approved: true, resolutionSource: "harness" });
  });

  it("approves when mock is truthy (not a rejection object)", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        { id: "confirm", type: "approval" } satisfies WorkflowApprovalStepInput,
      ]),
      { stepMocks: { confirm: { approved: true } } },
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps["confirm"].status).toBe("success");
  });

  it("rejects when mock has approved: false", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        { id: "confirm", type: "approval", reason: "Deploy?" } satisfies WorkflowApprovalStepInput,
      ]),
      { stepMocks: { confirm: { approved: false, reason: "Too risky" } } },
    );
    const result = await harness.run();
    expect(result.status).toBe("failed");
    expect(result.steps["confirm"].status).toBe("failed");
    expect(result.steps["confirm"].error).toContain("rejected");
    expect(result.steps["confirm"].error).toContain("Too risky");
  });

  it("continues after rejection when continueOnFailure is true", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        {
          id: "confirm",
          type: "approval",
          continueOnFailure: true,
        } satisfies WorkflowApprovalStepInput,
        { id: "next", type: "code", run: () => "next-ran" },
      ]),
      { stepMocks: { confirm: { approved: false } } },
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps["confirm"].status).toBe("failed");
    expect(result.steps["next"].status).toBe("success");
  });

  it("skips the approval step when when-predicate is false", async () => {
    const harness = new WorkflowTestHarness(
      makeWorkflow([
        {
          id: "confirm",
          type: "approval",
          when: () => false,
        } satisfies WorkflowApprovalStepInput,
      ]),
    );
    const result = await harness.run();
    expect(result.status).toBe("success");
    expect(result.steps["confirm"].status).toBe("skipped");
  });
});
