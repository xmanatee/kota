import { describe, expect, it } from "vitest";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { WorkflowTestHarness } from "./index.js";
import { makeStepResult } from "./results.js";

describe("WorkflowTestHarness — result evidence", () => {
  it("records code-step validation failures as explicit failed results", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "decode",
          type: "code",
          run: () => ({ ok: false }),
          validate: () => {
            throw new Error("missing observed field");
          },
        },
        {
          id: "after",
          type: "code",
          run: () => "unreachable",
        },
      ],
    };

    const result = await new WorkflowTestHarness(workflow).run();

    expect(result.status).toBe("failed");
    expect(result.error).toBe('Step "decode" output failed validation (run): missing observed field');
    expect(result.steps.decode).toMatchObject({
      id: "decode",
      type: "code",
      status: "failed",
      error: 'Step "decode" output failed validation (run): missing observed field',
    });
    expect(result.steps.decode.output).toBeUndefined();
    expect(result.steps.after).toBeUndefined();
  });

  it("exposes emitted events and restart requests on the public harness result", async () => {
    const workflow: WorkflowDefinitionInput = {
      name: "test",
      triggers: [],
      steps: [
        {
          id: "emit-event",
          type: "emit",
          event: "workflow.test.observed",
          payload: { ok: true },
        },
        {
          id: "restart",
          type: "restart",
          reason: "restart for test",
        },
      ],
    };

    const result = await new WorkflowTestHarness(workflow).run();

    expect(result.status).toBe("success");
    expect(result.emitted).toEqual([
      {
        event: "workflow.test.observed",
        schemaRef: null,
        payload: { ok: true },
      },
    ]);
    expect(result.restartRequested).toBe("restart for test");
    expect(result.steps["emit-event"].output).toEqual({
      event: "workflow.test.observed",
      payload: { ok: true },
    });
    expect(result.steps.restart.output).toEqual({
      event: "runtime.restart_requested",
      schemaRef: null,
      payload: { reason: "restart for test" },
    });
  });

  it("keeps harness and internal step results aligned", () => {
    const skipReason = { kind: "when-predicate" as const, label: "gate" };

    const result = makeStepResult(
      "observe",
      "code",
      "skipped",
      { value: 1 },
      "blocked",
      skipReason,
    );

    expect(result.harness).toMatchObject({
      id: "observe",
      type: "code",
      status: "skipped",
      output: { value: 1 },
      error: "blocked",
      skipReason,
    });
    expect(result.internal).toMatchObject({
      id: "observe",
      type: "code",
      status: "skipped",
      output: { value: 1 },
      error: "blocked",
      skipReason,
    });
    expect(result.internal.startedAt).toBeTruthy();
    expect(result.internal.completedAt).toBeTruthy();
  });
});
