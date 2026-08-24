import { describe, expect, it, vi } from "vitest";
import { registerSessionEnvironmentResource } from "#core/tools/session-environment.js";
import { RepairLoopError, RepairLoopYield } from "./repair-loop.js";
import {
  executeWorkflowStep,
  type StepAccumulators,
} from "./run-executor-step.js";
import { AgentStepRuntimeError } from "./steps/step-executor.js";

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
    trigger: { event: "runtime.idle" as const, schemaRef: null, payload: {} },
    startedAt: new Date().toISOString(),
    status: "running" as const,
    steps: [],
  };
  const trigger = { event: "runtime.idle" as const, schemaRef: null, payload: {} };

  const context = {
    projectDir: "/tmp",
    workflow: { name: "test-wf", runId: "run-cost-01", runDir: ".kota/runs/run-cost-01", definitionPath: "src/modules/test/workflows/test/workflow.ts" },
    trigger,
    previousOutput: undefined,
    stepOutputs: {},
    stepOutputList: [],
    runTool: vi.fn(),
  };
  const run = {
    metadata,
    recordStep: vi.fn(),
    appendAgentMessage: vi.fn(),
    writeAgentInputs: vi.fn(),
  };
  const bus = { emit: vi.fn() } as any;
  const pbus = {
    emit: bus.emit,
    getScopeId: () => "test-project",
    getProjectId: () => "test-project",
  } as any;
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

  it("binds direct workflow tools to an invocation session and tears it down", async () => {
    const cleanup = vi.fn();
    const runTool = vi.fn(async (_name, _input, toolContext) => {
      expect(toolContext).toMatchObject({
        stepId: "browser-read",
        sessionId: expect.stringMatching(/^workflow:/),
      });
      registerSessionEnvironmentResource(
        { ...toolContext, scopeId: "test-project", projectId: "test-project" },
        cleanup,
      );
      return { content: "ok" };
    });
    executeStepMock.mockImplementationOnce(
      async (_definition, _step, _metadata, _trigger, stepContext) =>
        stepContext.runTool("browser_get_text", {}, { stepId: "browser-read" }),
    );
    const step = {
      id: "browser-read",
      type: "tool" as const,
      tool: "browser_get_text",
    };

    const result = await executeWorkflowStep(
      definition as any,
      step as any,
      run,
      trigger,
      { ...context, runTool } as any,
      new AbortController(),
      agentConfig,
      makeAcc(),
      { bus, pbus, log },
      Date.now(),
    );

    expect(result.completed.status).toBe("success");
    expect(runTool).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
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

  it("records terminal repair evidence and cost on the failed step", async () => {
    const output = {
      content: "repair did not resolve the check",
      turns: 3,
      totalCostUsd: 0.21,
      inputTokens: 92_328,
      outputTokens: 3_189,
      repairIterations: [
        {
          attempt: 1,
          failures: [
            { id: "lint", output: "lint failed", passed: false, severity: "error" as const },
          ],
        },
      ],
      repairWarnings: [],
      continuationDecisions: [],
    };
    executeStepMock.mockRejectedValueOnce(
      new RepairLoopError(
        "repair-no-progress",
        "build",
        ["lint"],
        output,
        "repair made no progress",
        new AgentStepRuntimeError("provider repair failed", "provider", false),
      ),
    );

    const step = { id: "build", type: "agent" as const, promptPath: "prompt.md" };
    const result = await executeWorkflowStep(
      definition as any,
      step as any,
      run,
      trigger,
      context as any,
      new AbortController(),
      agentConfig,
      makeAcc(),
      { bus, pbus, log },
      Date.now(),
    );

    expect(result.completed).toMatchObject({
      status: "failed",
      errorKind: "repair-no-progress",
      costUsd: 0.21,
      inputTokens: 92_328,
      outputTokens: 3_189,
      output: { repairIterations: output.repairIterations },
    });
    expect(result.agentBackoff).toMatchObject({
      kind: "provider",
      reason: "provider repair failed",
    });
  });

  it("records preserve-yield as a first-class step transition", async () => {
    const decision = {
      decision: "preserve-yield" as const,
      evidenceKey: "priority-boundary",
      summary: "Useful work is durable and P0 Safety work is ready.",
      nextAction: "Resume the same work after the P0 task.",
      packet: {
        schemaVersion: 1 as const,
        boundaryKey: "priority-boundary",
        boundaryReasons: ["higher-priority:task-p0:p0:Safety"],
        attempt: 0,
        failureIds: ["critic-review"],
        warningIds: [],
        progressKey: "progress",
        trajectory: {
          classification: "fresh",
          attempts: 0,
          failureIdsByAttempt: [["critic-review"]],
        },
        context: [],
      },
    };
    const output = {
      content: "useful work is checkpointed",
      turns: 3,
      totalCostUsd: 0.21,
      inputTokens: 92_328,
      outputTokens: 3_189,
      repairIterations: [],
      repairWarnings: [],
      continuationDecisions: [decision],
    };
    executeStepMock.mockRejectedValueOnce(
      new RepairLoopYield("build", output, decision),
    );

    const step = { id: "build", type: "agent" as const, promptPath: "prompt.md" };
    await expect(
      executeWorkflowStep(
        definition as any,
        step as any,
        run,
        trigger,
        context as any,
        new AbortController(),
        agentConfig,
        makeAcc(),
        { bus, pbus, log },
        Date.now(),
      ),
    ).rejects.toBeInstanceOf(RepairLoopYield);

    expect(run.recordStep).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "yielded",
        output: expect.objectContaining({
          continuationDecisions: [
            expect.objectContaining({ decision: "preserve-yield" }),
          ],
        }),
      }),
    );
    expect(bus.emit).toHaveBeenCalledWith(
      "workflow.step.completed",
      expect.objectContaining({ status: "yielded" }),
    );
  });
});
