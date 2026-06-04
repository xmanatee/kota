import { describe, expect, it, vi } from "vitest";
import type { WorkflowStepContext } from "../run-types.js";
import type { WorkflowTriggerStep } from "../step-types.js";
import { executeTriggerStep } from "./step-executor-trigger.js";

function makeContext(
  overrides: Partial<WorkflowStepContext> = {},
): WorkflowStepContext {
  return {
    projectDir: "/project",
    workflow: {
      name: "parent",
      definitionPath: "src/modules/test/workflows/parent/workflow.ts",
      runId: "run-1",
      runDir: ".kota/runs/run-1",
      runDirPath: "/project/.kota/runs/run-1",
    },
    trigger: { event: "runtime.idle", schemaRef: null, payload: { taskId: "task-123" } },
    previousOutput: null,
    stepOutputs: {},
    stepResults: {},
    stepOutputList: [],
    runTool: () => Promise.reject(new Error("not used")),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({
      completedRuns: 0,
      pendingRuns: [],
      workflows: {},
    }),
    reportProgress: () => {},
    triggerWorkflow: vi.fn().mockResolvedValue({ runId: "child-run-1", status: "queued" }),
    ...overrides,
  };
}

function makeTriggerStep(
  overrides: Partial<WorkflowTriggerStep> = {},
): WorkflowTriggerStep {
  return {
    id: "trigger-child",
    type: "trigger",
    workflow: "child-workflow",
    waitFor: "queued",
    ...overrides,
  };
}

describe("executeTriggerStep", () => {
  it("calls triggerWorkflow with waitFor: queued and returns output", async () => {
    const context = makeContext();
    const step = makeTriggerStep({ waitFor: "queued" });

    const result = await executeTriggerStep(step, context);

    expect(context.triggerWorkflow).toHaveBeenCalledWith(
      "child-workflow",
      {},
      "queued",
      undefined,
    );
    expect(result).toEqual({ runId: "child-run-1", status: "queued" });
  });

  it("calls triggerWorkflow with waitFor: completed and returns output", async () => {
    const mockTrigger = vi.fn().mockResolvedValue({ runId: "child-run-2", status: "completed" });
    const context = makeContext({ triggerWorkflow: mockTrigger });
    const step = makeTriggerStep({ waitFor: "completed" });

    const result = await executeTriggerStep(step, context);

    expect(mockTrigger).toHaveBeenCalledWith(
      "child-workflow",
      {},
      "completed",
      undefined,
    );
    expect(result).toEqual({ runId: "child-run-2", status: "completed" });
  });

  it("returns childOutput when waitFor: completed and child produced output", async () => {
    const mockTrigger = vi.fn().mockResolvedValue({
      runId: "child-run-3",
      status: "completed",
      childOutput: { summary: "done" },
    });
    const context = makeContext({ triggerWorkflow: mockTrigger });
    const step = makeTriggerStep({ waitFor: "completed" });

    const result = await executeTriggerStep(step, context);

    expect(result).toEqual({ runId: "child-run-3", status: "completed", childOutput: { summary: "done" } });
  });

  it("does not include childOutput when waitFor: queued", async () => {
    const context = makeContext();
    const step = makeTriggerStep({ waitFor: "queued" });

    const result = await executeTriggerStep(step, context);

    expect(result).toEqual({ runId: "child-run-1", status: "queued" });
    expect(result).not.toHaveProperty("childOutput");
  });

  it("passes static payload to triggerWorkflow", async () => {
    const context = makeContext();
    const step = makeTriggerStep({ payload: { source: "parent", count: 3 } });

    await executeTriggerStep(step, context);

    expect(context.triggerWorkflow).toHaveBeenCalledWith(
      "child-workflow",
      { source: "parent", count: 3 },
      "queued",
      undefined,
    );
  });

  it("interpolates {{trigger.payload.field}} in payload strings", async () => {
    const context = makeContext({
      trigger: { event: "runtime.idle", schemaRef: null, payload: { taskId: "task-abc" } },
    });
    const step = makeTriggerStep({
      payload: { source: "builder", taskId: "{{trigger.payload.taskId}}" },
    });

    await executeTriggerStep(step, context);

    expect(context.triggerWorkflow).toHaveBeenCalledWith(
      "child-workflow",
      { source: "builder", taskId: "task-abc" },
      "queued",
      undefined,
    );
  });

  it("leaves unresolvable template expressions unchanged", async () => {
    const context = makeContext();
    const step = makeTriggerStep({
      payload: { id: "{{trigger.payload.missing}}" },
    });

    await executeTriggerStep(step, context);

    expect(context.triggerWorkflow).toHaveBeenCalledWith(
      "child-workflow",
      { id: "{{trigger.payload.missing}}" },
      "queued",
      undefined,
    );
  });

  it("passes the abort signal to triggerWorkflow", async () => {
    const context = makeContext();
    const step = makeTriggerStep({ waitFor: "completed" });
    const controller = new AbortController();

    await executeTriggerStep(step, context, controller.signal);

    expect(context.triggerWorkflow).toHaveBeenCalledWith(
      "child-workflow",
      {},
      "completed",
      controller.signal,
    );
  });

  it("supports function payload resolver", async () => {
    const context = makeContext({
      stepOutputs: { "prev-step": { count: 7 } },
    });
    const step = makeTriggerStep({
      payload: (ctx) => ({ count: (ctx.stepOutputs["prev-step"] as { count: number }).count }),
    });

    await executeTriggerStep(step, context);

    expect(context.triggerWorkflow).toHaveBeenCalledWith(
      "child-workflow",
      { count: 7 },
      "queued",
      undefined,
    );
  });

  it("propagates errors from triggerWorkflow", async () => {
    const mockTrigger = vi.fn().mockRejectedValue(new Error("Unknown workflow"));
    const context = makeContext({ triggerWorkflow: mockTrigger });
    const step = makeTriggerStep({ workflow: "nonexistent" });

    await expect(executeTriggerStep(step, context)).rejects.toThrow("Unknown workflow");
  });
});
