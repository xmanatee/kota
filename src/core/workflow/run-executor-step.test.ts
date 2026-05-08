import { describe, expect, it, vi } from "vitest";
import {
  applyOutputSizeLimit,
  DEFAULT_MAX_STEP_OUTPUT_BYTES,
  executeWorkflowStep,
  HARD_MAX_STEP_OUTPUT_BYTES,
  type StepAccumulators,
} from "./run-executor-step.js";

const executeStepMock = vi.hoisted(() => vi.fn());
vi.mock("./steps/step-executor.js", () => ({
  executeStep: executeStepMock,
  AgentStepRuntimeError: class AgentStepRuntimeError extends Error {
    kind: string;
    retryable: boolean;
    constructor(msg: string, kind: string, retryable: boolean) {
      super(msg);
      this.kind = kind;
      this.retryable = retryable;
    }
  },
}));

describe("applyOutputSizeLimit", () => {
  it("returns output unchanged when below the default limit", () => {
    const output = { data: "small" };
    const result = applyOutputSizeLimit(output, undefined);
    expect(result.output).toEqual(output);
    expect(result.warning).toBeUndefined();
  });

  it("returns output unchanged when exactly at the limit", () => {
    const str = "x".repeat(DEFAULT_MAX_STEP_OUTPUT_BYTES - 2); // JSON adds surrounding quotes
    const output = str;
    const serialized = JSON.stringify(output);
    expect(Buffer.byteLength(serialized, "utf-8")).toBeLessThanOrEqual(DEFAULT_MAX_STEP_OUTPUT_BYTES);
    const result = applyOutputSizeLimit(output, undefined);
    expect(result.output).toEqual(output);
    expect(result.warning).toBeUndefined();
  });

  it("truncates output exceeding the default limit with a structured notice", () => {
    const largeOutput = { data: "x".repeat(DEFAULT_MAX_STEP_OUTPUT_BYTES) };
    const result = applyOutputSizeLimit(largeOutput, undefined);
    expect(result.output).toMatchObject({
      truncated: true,
      originalBytes: expect.any(Number),
      message: expect.stringContaining("truncated"),
    });
    expect((result.output as { originalBytes: number }).originalBytes).toBeGreaterThan(DEFAULT_MAX_STEP_OUTPUT_BYTES);
    expect(result.warning).toBeDefined();
    expect(result.warning?.type).toBe("step-output-truncated");
  });

  it("respects a custom maxBytes limit", () => {
    const output = { value: "hello world" };
    const serialized = JSON.stringify(output);
    const byteLen = Buffer.byteLength(serialized, "utf-8");
    // Limit is just below the serialized size
    const result = applyOutputSizeLimit(output, byteLen - 1);
    expect(result.output).toMatchObject({ truncated: true, originalBytes: byteLen });
    expect(result.warning).toBeDefined();
  });

  it("enforces the hard cap even when maxBytes is set higher", () => {
    const overLimit = HARD_MAX_STEP_OUTPUT_BYTES + 1;
    const largeOutput = { data: "x".repeat(overLimit) };
    // Setting maxBytes above the hard cap should still truncate
    const result = applyOutputSizeLimit(largeOutput, overLimit * 2);
    expect(result.output).toMatchObject({ truncated: true });
    expect(result.warning).toBeDefined();
  });

  it("passes through undefined and null without truncation", () => {
    expect(applyOutputSizeLimit(undefined, undefined)).toEqual({ output: undefined });
    expect(applyOutputSizeLimit(null, undefined)).toEqual({ output: null });
  });

  it("includes the original byte count in the truncation notice", () => {
    const largeOutput = "x".repeat(DEFAULT_MAX_STEP_OUTPUT_BYTES + 100);
    const result = applyOutputSizeLimit(largeOutput, undefined);
    const notice = result.output as { truncated: boolean; originalBytes: number; message: string };
    expect(notice.originalBytes).toBe(Buffer.byteLength(JSON.stringify(largeOutput), "utf-8"));
  });

  it("replaces non-serializable output with a structured warning notice", () => {
    const output: Record<string, unknown> = {};
    output.self = output;
    const result = applyOutputSizeLimit(output, undefined);
    expect(result.output).toMatchObject({
      truncated: true,
      originalBytes: 0,
      message: expect.stringContaining("could not be serialized"),
    });
    expect(result.warning).toMatchObject({
      type: "step-output-truncated",
      message: expect.stringContaining("could not be serialized"),
    });
  });
});

describe("executeWorkflowStep — costUsd capture", () => {
  function makeAcc(): StepAccumulators {
    return { stepOutputsById: {}, stepResultsById: {}, stepOutputs: [], warnings: [] };
  }

  const definition = {
    name: "test-wf",
    enabled: true,
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    triggers: [],
    steps: [],
  };

  const metadata = {
    id: "run-cost-01",
    workflow: "test-wf",
    runDir: ".kota/runs/run-cost-01",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    trigger: { event: "runtime.idle" as const, payload: {} },
    startedAt: new Date().toISOString(),
    status: "running" as const,
    steps: [],
  };

  const trigger = { event: "runtime.idle" as const, payload: {} };

  const context = {
    projectDir: "/tmp",
    workflow: { name: "test-wf", runId: "run-cost-01", runDir: ".kota/runs/run-cost-01", definitionPath: "src/modules/test/workflows/test/workflow.ts" },
    trigger,
    previousOutput: undefined,
    stepOutputs: {},
    stepOutputList: [],
  };

  const run = {
    metadata,
    recordStep: vi.fn(),
    appendAgentMessage: vi.fn(),
    writeAgentInputs: vi.fn(),
  };

  const bus = { emit: vi.fn() } as any;
  const pbus = { emit: bus.emit, getProjectId: () => "test-project" } as any;
  const log = vi.fn();
  const agentConfig = { config: {}, log, projectDir: "/tmp" } as any;

  it("captures costUsd from agent step output onto WorkflowStepResult", async () => {
    const agentOutput = { content: "done", totalCostUsd: 0.42, turns: 3 };
    executeStepMock.mockResolvedValueOnce({
      output: agentOutput,
      harness: "claude-agent-sdk",
      model: "claude-opus-4-7",
    });

    const step = { id: "build", type: "agent" as const, promptPath: "prompt.md" };
    const acc = makeAcc();
    const result = await executeWorkflowStep(
      definition as any, step as any, run, trigger, context as any,
      new AbortController(), agentConfig, acc, { bus, pbus, log }, Date.now(),
    );

    expect(result.completed.costUsd).toBe(0.42);
    expect(result.completed.harness).toBe("claude-agent-sdk");
    expect(result.completed.model).toBe("claude-opus-4-7");
    expect(bus.emit).toHaveBeenCalledWith(
      "workflow.step.completed",
      expect.objectContaining({ costUsd: 0.42 }),
    );
  });

  it("does not set costUsd on non-agent steps", async () => {
    executeStepMock.mockResolvedValueOnce("ok");
    const step = { id: "emit-step", type: "emit" as const, event: "test.event", payload: {} };
    const acc = makeAcc();
    const result = await executeWorkflowStep(
      definition as any, step as any, run, trigger, context as any,
      new AbortController(), agentConfig, acc, { bus, pbus, log }, Date.now(),
    );

    expect(result.completed.costUsd).toBeUndefined();
  });

  it("does not set costUsd when agent output lacks totalCostUsd", async () => {
    executeStepMock.mockResolvedValueOnce({
      output: { content: "done" },
      harness: "claude-agent-sdk",
      model: "claude-opus-4-7",
    });
    const step = { id: "build", type: "agent" as const, promptPath: "prompt.md" };
    const acc = makeAcc();
    const result = await executeWorkflowStep(
      definition as any, step as any, run, trigger, context as any,
      new AbortController(), agentConfig, acc, { bus, pbus, log }, Date.now(),
    );

    expect(result.completed.costUsd).toBeUndefined();
  });
});
