import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeWithAgentSDK } from "../agent-sdk/index.js";
import type { AgentStepConfig } from "./step-executor.js";
import { buildAgentPrompt, executeAgentStep, withRetry } from "./step-executor.js";
import type {
  WorkflowAgentStep,
  WorkflowDefinition,
  WorkflowRunMetadata,
  WorkflowRunTrigger,
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
