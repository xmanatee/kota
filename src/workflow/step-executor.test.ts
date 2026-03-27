import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeWithAgentSDK } from "../agent-sdk/index.js";
import type { AgentStepConfig } from "./step-executor.js";
import {
  buildAgentPrompt,
  buildRepairPrompt,
  executeAgentStep,
  executeStep,
  executeToolStep,
  withRetry,
} from "./step-executor.js";
import type {
  WorkflowAgentStep,
  WorkflowDefinition,
  WorkflowRunMetadata,
  WorkflowRunTrigger,
  WorkflowStepContext,
  WorkflowToolStep,
} from "./types.js";

vi.mock("../agent-sdk/index.js", async () => {
  const actual = await vi.importActual("../agent-sdk/index.js");
  return {
    ...actual,
    executeWithAgentSDK: vi.fn(),
  };
});

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

function makeStep(overrides: Partial<WorkflowAgentStep> = {}): WorkflowAgentStep {
  return {
    id: "test-step",
    type: "agent",
    promptPath: "src/workflows/test/prompt.md",
    permissionMode: "bypassPermissions",
    settingSources: [],
    ...overrides,
  };
}

function makeDefinition(): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    definitionPath: "src/workflows/test/workflow.ts",
    triggers: [],
    steps: [],
  };
}

function makeMetadata(): WorkflowRunMetadata {
  return {
    id: "run-1",
    workflow: "test",
    definitionPath: "src/workflows/test/workflow.ts",
    trigger: { event: "runtime.idle", payload: {} },
    startedAt: new Date().toISOString(),
    status: "running",
    runDir: ".kota/runs/run-1",
    steps: [],
  };
}

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", payload: {} };

const SUCCESS_RESULT = {
  text: "done",
  streamedText: "",
  sessionId: "sess-1",
  turns: 1,
  totalCostUsd: 0.01,
  subtype: "success",
  isError: false,
};

describe("executeAgentStep timeout", () => {
  let projectDir: string;
  let agentConfig: AgentStepConfig;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "src", "workflows", "test"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "workflows", "test", "prompt.md"),
      "Test prompt.\n",
    );
    agentConfig = { projectDir };
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("completes successfully when step finishes before timeout", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, "abort");
    const step = makeStep({ timeoutMs: 60_000 });

    const result = await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata(),
      TRIGGER,
      abortController,
      () => {},
      () => {},
      agentConfig,
    );

    expect(result).toMatchObject({ content: "done", turns: 1 });
    expect(abortSpy).not.toHaveBeenCalled();
  });

  it("aborts the step after timeoutMs elapses", async () => {
    const abortController = new AbortController();

    // Mock returns a promise that rejects when aborted
    mockedExecuteWithAgentSDK.mockImplementation((_prompt, options) => {
      return new Promise<typeof SUCCESS_RESULT>((_resolve, reject) => {
        options?.abortController?.signal.addEventListener("abort", () => {
          reject(options!.abortController!.signal.reason);
        });
      });
    });

    const step = makeStep({ timeoutMs: 20 });

    await expect(
      executeAgentStep(
        makeDefinition(),
        step,
        makeMetadata(),
        TRIGGER,
        abortController,
        () => {},
        () => {},
        agentConfig,
      ),
    ).rejects.toThrow('Agent step "test-step" timed out after 20ms');

    expect(abortController.signal.aborted).toBe(true);
  });

  it("does not abort when timeoutMs is undefined", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, "abort");
    const step = makeStep(); // no timeoutMs

    await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata(),
      TRIGGER,
      abortController,
      () => {},
      () => {},
      agentConfig,
    );

    expect(abortSpy).not.toHaveBeenCalled();
  });

  it("retries on failure and succeeds on second attempt", async () => {
    mockedExecuteWithAgentSDK
      .mockRejectedValueOnce(new Error("transient network error"))
      .mockResolvedValue(SUCCESS_RESULT);

    const logs: string[] = [];
    const step = makeStep({
      retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 2 },
    });

    const result = await executeAgentStep(
      makeDefinition(),
      step,
      makeMetadata(),
      TRIGGER,
      new AbortController(),
      () => {},
      () => {},
      { ...agentConfig, log: (msg) => logs.push(msg) },
    );

    expect(result).toMatchObject({ content: "done" });
    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("Attempt 1/2 failed");
  });

  it("fails after exhausting all retry attempts", async () => {
    mockedExecuteWithAgentSDK.mockRejectedValue(new Error("persistent error"));

    const logs: string[] = [];
    const step = makeStep({
      retry: { maxAttempts: 3, initialDelayMs: 1, backoffFactor: 1 },
    });

    await expect(
      executeAgentStep(
        makeDefinition(),
        step,
        makeMetadata(),
        TRIGGER,
        new AbortController(),
        () => {},
        () => {},
        { ...agentConfig, log: (msg) => logs.push(msg) },
      ),
    ).rejects.toThrow("persistent error");

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(3);
    expect(logs).toHaveLength(2); // logged after attempt 1 and 2, not after final
  });

  it("does not retry when retry config is absent", async () => {
    mockedExecuteWithAgentSDK.mockRejectedValue(new Error("one-shot error"));

    const step = makeStep(); // no retry

    await expect(
      executeAgentStep(
        makeDefinition(),
        step,
        makeMetadata(),
        TRIGGER,
        new AbortController(),
        () => {},
        () => {},
        agentConfig,
      ),
    ).rejects.toThrow("one-shot error");

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);
  });
});

describe("buildAgentPrompt", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-build-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "src", "workflows", "test"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "workflows", "test", "prompt.md"),
      "Test prompt.\n",
    );
  });

  it("omits prior step outputs section when all outputs are empty", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(),
      makeMetadata(),
      TRIGGER,
      projectDir,
      {},
    );
    expect(prompt).not.toContain("Prior step outputs:");
  });

  it("omits skipped steps from prior step outputs", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(),
      makeMetadata(),
      TRIGGER,
      projectDir,
      { "some-step": { skipped: true } },
    );
    expect(prompt).not.toContain("Prior step outputs:");
  });

  it("injects non-skipped prior step outputs into prompt", () => {
    const output = { counts: { ready: 3 }, actionableCount: 3 };
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(),
      makeMetadata(),
      TRIGGER,
      projectDir,
      { "inspect-ready-queue": output },
    );
    expect(prompt).toContain("Prior step outputs:");
    expect(prompt).toContain('<step id="inspect-ready-queue">');
    expect(prompt).toContain('"ready": 3');
  });

  it("injects multiple prior step outputs in order", () => {
    const outputs = {
      "gather-context": { recentRuns: [] },
      "inspect-queue": { counts: { ready: 2 } },
    };
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(),
      makeMetadata(),
      TRIGGER,
      projectDir,
      outputs,
    );
    const gatherIdx = prompt.indexOf('<step id="gather-context">');
    const inspectIdx = prompt.indexOf('<step id="inspect-queue">');
    expect(gatherIdx).toBeGreaterThan(-1);
    expect(inspectIdx).toBeGreaterThan(-1);
    expect(gatherIdx).toBeLessThan(inspectIdx);
  });
});

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, backoffFactor: 2 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries and succeeds on last attempt", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { maxAttempts: 3, initialDelayMs: 1, backoffFactor: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws last error after all attempts exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    await expect(
      withRetry(fn, { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 }),
    ).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("applies exponential backoff between attempts", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue("ok");

    const logs: string[] = [];
    const promise = withRetry(
      fn,
      { maxAttempts: 3, initialDelayMs: 100, backoffFactor: 3 },
      (msg) => logs.push(msg),
    );

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(300);
    await promise;

    expect(fn).toHaveBeenCalledTimes(3);
    expect(logs[0]).toContain("retrying in 100ms");
    expect(logs[1]).toContain("retrying in 300ms");
    vi.useRealTimers();
  });
});

describe("executeToolStep retry", () => {
  it("retries on failure and succeeds on second attempt", async () => {
    let calls = 0;
    const context = {
      runTool: vi.fn().mockImplementation(async () => {
        calls++;
        if (calls === 1) throw new Error("transient");
        return { content: "ok" };
      }),
    } as unknown as Parameters<typeof executeToolStep>[1];

    const step: WorkflowToolStep = {
      id: "verify-test",
      type: "tool",
      tool: "shell",
      input: { command: "npm test" },
      retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 },
    };

    const result = await executeToolStep(step, context);
    expect(result).toMatchObject({ content: "ok" });
    expect(calls).toBe(2);
  });

  it("does not retry when retry config is absent", async () => {
    const context = {
      runTool: vi.fn().mockRejectedValue(new Error("fail")),
    } as unknown as Parameters<typeof executeToolStep>[1];

    const step: WorkflowToolStep = {
      id: "verify-test",
      type: "tool",
      tool: "shell",
      input: { command: "npm test" },
    };

    await expect(executeToolStep(step, context)).rejects.toThrow("fail");
    expect(context.runTool).toHaveBeenCalledTimes(1);
  });
});

describe("buildRepairPrompt", () => {
  it("includes attempt info and failed check output", () => {
    const step = makeStep({ id: "build" });
    const failures = [{ id: "verify-lint", passed: false, output: "error: semicolon" }];
    const prompt = buildRepairPrompt(1, 3, failures, step);
    expect(prompt).toContain("repair attempt 1/3");
    expect(prompt).toContain('"build"');
    expect(prompt).toContain("## verify-lint");
    expect(prompt).toContain("error: semicolon");
    expect(prompt).toContain("Fix these issues now");
  });

  it("includes all failures", () => {
    const step = makeStep();
    const failures = [
      { id: "check-a", passed: false, output: "error A" },
      { id: "check-b", passed: false, output: "error B" },
    ];
    const prompt = buildRepairPrompt(2, 5, failures, step);
    expect(prompt).toContain("## check-a");
    expect(prompt).toContain("error A");
    expect(prompt).toContain("## check-b");
    expect(prompt).toContain("error B");
  });
});

describe("executeStep repair loop", () => {
  let projectDir: string;
  let agentConfig: AgentStepConfig;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-repair-loop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "src", "workflows", "test"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "workflows", "test", "prompt.md"),
      "Test prompt.\n",
    );
    agentConfig = { projectDir };
    mockedExecuteWithAgentSDK.mockReset();
  });

  function makeRepairContext(runTool: WorkflowStepContext["runTool"]): WorkflowStepContext {
    return {
      projectDir,
      workflow: {
        name: "test",
        definitionPath: "src/workflows/test/workflow.ts",
        runId: "run-1",
        runDir: ".kota/runs/run-1",
        runDirPath: `${projectDir}/.kota/runs/run-1`,
      },
      trigger: TRIGGER,
      previousOutput: null,
      stepOutputs: {},
      stepResults: {},
      stepOutputList: [],
      runTool,
      emit: () => {},
      requestRestart: () => {},
      readPrompt: () => "",
      readRuntimeState: () => ({
        completedRuns: 0,
        pendingRuns: [],
        workflows: {},
      }),
    };
  }

  it("happy path: no repair needed when all checks pass", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    const runTool = vi.fn().mockResolvedValue({ content: "all good", is_error: false });
    const context = makeRepairContext(runTool);
    const step = makeStep({
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [{ id: "check-lint", tool: "shell", input: { command: "npm run lint" } }],
      },
    });

    const result = await executeStep(
      makeDefinition(),
      step,
      makeMetadata(),
      TRIGGER,
      context,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    );

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ content: "done", repairIterations: [] });
  });

  it("repair success: agent fixes issue on first repair attempt", async () => {
    mockedExecuteWithAgentSDK
      .mockResolvedValueOnce(SUCCESS_RESULT) // initial agent run
      .mockResolvedValueOnce({ ...SUCCESS_RESULT, text: "fixed", turns: 2, totalCostUsd: 0.02 }); // repair agent

    const runTool = vi
      .fn()
      .mockRejectedValueOnce(new Error("lint error: missing semicolon")) // first check fails
      .mockResolvedValue({ content: "lint passed", is_error: false }); // second check passes

    const context = makeRepairContext(runTool);
    const step = makeStep({
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [{ id: "check-lint", tool: "shell", input: { command: "npm run lint" } }],
      },
    });

    const result = await executeStep(
      makeDefinition(),
      step,
      makeMetadata(),
      TRIGGER,
      context,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    ) as Record<string, unknown>;

    // Initial agent + repair agent = 2 calls
    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
    // First check fails, repair runs, second check passes
    expect(runTool).toHaveBeenCalledTimes(2);

    expect(result.content).toBe("fixed");
    expect(result.turns).toBe(3); // 1 initial + 2 repair
    expect(result.totalCostUsd).toBeCloseTo(0.03); // 0.01 + 0.02

    const iterations = result.repairIterations as Array<Record<string, unknown>>;
    expect(iterations).toHaveLength(1);
    expect(iterations[0].attempt).toBe(1);
    expect(iterations[0].agentResponse).toBe("fixed");
    const failures = iterations[0].failures as Array<{ id: string }>;
    expect(failures[0].id).toBe("check-lint");
  });

  it("budget exhaustion: throws after maxRepairAttempts with still-failing checks", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT); // initial + repair agents all succeed

    const runTool = vi
      .fn()
      .mockRejectedValue(new Error("typecheck error: type mismatch")); // checks always fail

    const context = makeRepairContext(runTool);
    const step = makeStep({
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [{ id: "check-typecheck", tool: "shell", input: { command: "npm run typecheck" } }],
      },
    });

    await expect(
      executeStep(
        makeDefinition(),
        step,
        makeMetadata(),
        TRIGGER,
        context,
        new AbortController(),
        () => {},
        () => {},
        agentConfig,
      ),
    ).rejects.toThrow('Repair loop for step "test-step" exhausted budget (2 attempt(s))');

    // Initial agent + 2 repair agents (one per attempt): maxRepairAttempts=2 means 2 repair runs
    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(3);
    // Initial check + 1 post-repair check per attempt = 3 check rounds total
    expect(runTool).toHaveBeenCalledTimes(3);
  });
});
