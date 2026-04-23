import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";
import {
  KOTA_OWNER_QUESTIONS_MCP_SERVER,
  KOTA_OWNER_QUESTIONS_MCP_TOOL,
} from "#modules/claude-agent-harness/kota-tools-mcp.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "../run-types.js";
import type {
  WorkflowAgentStep,
  WorkflowDefinition,
  WorkflowEmitStep,
  WorkflowNotifyConfig,
  WorkflowRunTrigger,
  WorkflowToolStep,
} from "../types.js";
import type { AgentStepConfig } from "./step-executor.js";
import {
  buildAgentPrompt,
  buildRepairPrompt,
  executeAgentStep,
  executeEmitStep,
  executeStep,
  executeToolStep,
  withRetry,
} from "./step-executor.js";
import { classifyAgentRuntimeFailure } from "./step-executor-retry.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual("../../../modules/claude-agent-harness/executor.js");
  return {
    ...actual,
    executeWithAgentSDK: vi.fn(),
  };
});

import "#modules/claude-agent-harness/index.js";

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

function makeStep(
  moduleRoot: string,
  overrides: Partial<WorkflowAgentStep> = {},
): WorkflowAgentStep {
  return {
    id: "test-step",
    type: "agent",
    promptPath: "src/modules/test/workflows/test/prompt.md",
    moduleRoot,
    model: "claude-opus-4-7",
    effort: "xhigh",
    permissionMode: "bypassPermissions",
    settingSources: [],
    autonomyMode: "autonomous",
    harness: "claude-agent-sdk",
    ...overrides,
  };
}

function makeDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    recoveryCapable: false,
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    moduleRoot: "/test-module-root",
    triggers: [],
    steps: [],
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

function makeMetadata(): WorkflowRunMetadata {
  return {
    id: "run-1",
    workflow: "test",
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
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

describe("executeAgentStep", () => {
  let projectDir: string;
  let agentConfig: AgentStepConfig;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "src", "modules", "test", "workflows", "test"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "modules", "test", "workflows", "test", "prompt.md"),
      "Test prompt.\n",
    );
    agentConfig = { projectDir };
    mockedExecuteWithAgentSDK.mockReset();
  });

  it("completes successfully", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    const result = await executeAgentStep(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    );

    expect(result.output).toMatchObject({ content: "done", turns: 1 });
    expect(result.harness).toBe("claude-agent-sdk");
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("exposes ask_owner to agent steps through the SDK MCP bridge", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    await executeAgentStep(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    );

    const options = mockedExecuteWithAgentSDK.mock.calls[0]?.[1];
    expect(options?.mcpServers).toHaveProperty(KOTA_OWNER_QUESTIONS_MCP_SERVER);
  });

  it("passes the daemon host-control guard to workflow agent steps", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    await executeAgentStep(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    );

    const guard = mockedExecuteWithAgentSDK.mock.calls[0]?.[1]?.canUseTool;
    expect(guard).toEqual(expect.any(Function));
    const denied = await guard?.("Bash", { command: "pnpm kota daemon stop" }, {
      signal: new AbortController().signal,
      toolUseID: "tool-1",
    });
    expect(denied).toMatchObject({ behavior: "deny" });
    expect(denied).not.toHaveProperty("interrupt");
  });

  it("keeps ask_owner available when an agent step has an allowedTools list", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    await executeAgentStep(
      makeDefinition(),
      makeStep(projectDir, { allowedTools: ["Read"] }),
      makeMetadata(),
      TRIGGER,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    );

    const options = mockedExecuteWithAgentSDK.mock.calls[0]?.[1];
    expect(options?.allowedTools).toEqual(["Read", KOTA_OWNER_QUESTIONS_MCP_TOOL]);
  });

  it("keeps ask_owner available when an agent step has a disallowedTools list", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    await executeAgentStep(
      makeDefinition(),
      makeStep(projectDir, { disallowedTools: ["Bash", KOTA_OWNER_QUESTIONS_MCP_TOOL] }),
      makeMetadata(),
      TRIGGER,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    );

    const options = mockedExecuteWithAgentSDK.mock.calls[0]?.[1];
    expect(options?.disallowedTools).toEqual(["Bash"]);
  });

  it("aborts when the provided abort controller is triggered externally", async () => {
    const abortController = new AbortController();

    mockedExecuteWithAgentSDK.mockImplementation((_prompt, options) => {
      return new Promise<typeof SUCCESS_RESULT>((_resolve, reject) => {
        options?.abortController?.signal.addEventListener("abort", () => {
          reject(options!.abortController!.signal.reason);
        });
      });
    });

    const step = makeStep(projectDir);
    const rejectReason = new Error("external abort");
    setTimeout(() => abortController.abort(rejectReason), 10);

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
    ).rejects.toThrow("external abort");

    expect(abortController.signal.aborted).toBe(true);
  });

  it("retries classified transient failures and succeeds on second attempt", async () => {
    const networkError = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    mockedExecuteWithAgentSDK
      .mockRejectedValueOnce(networkError)
      .mockResolvedValue(SUCCESS_RESULT);

    const logs: string[] = [];
    const step = makeStep(projectDir, {
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

    expect(result.output).toMatchObject({ content: "done" });
    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("Attempt 1/2 failed");
  });

  it("fails after exhausting all retry attempts on classified provider errors", async () => {
    const providerError = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    mockedExecuteWithAgentSDK.mockRejectedValue(providerError);

    const logs: string[] = [];
    const step = makeStep(projectDir, {
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
    ).rejects.toThrow("socket hang up");

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(3);
    expect(logs).toHaveLength(2); // logged after attempt 1 and 2, not after final
  });

  it("fails hard on the first attempt for unclassified errors", async () => {
    mockedExecuteWithAgentSDK.mockRejectedValue(
      new Error("agent produced nonsense"),
    );

    const step = makeStep(projectDir, {
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
        agentConfig,
      ),
    ).rejects.toThrow("agent produced nonsense");

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);
  });

  it("applies the runtime default retry when no explicit retry is configured", async () => {
    vi.useFakeTimers();
    try {
      const providerError = Object.assign(new Error("socket hang up"), {
        code: "ECONNRESET",
      });
      mockedExecuteWithAgentSDK.mockRejectedValue(providerError);

      const step = makeStep(projectDir); // no retry — default applies implicitly

      const promise = executeAgentStep(
        makeDefinition(),
        step,
        makeMetadata(),
        TRIGGER,
        new AbortController(),
        () => {},
        () => {},
        agentConfig,
      );
      // Swallow the rejection now so the fake-timer advancement doesn't
      // surface it as an unhandled rejection before the final assertion.
      const rejected = promise.catch((err) => err);

      // DEFAULT_AGENT_STEP_RETRY.initialDelayMs === 5000
      await vi.advanceTimersByTimeAsync(5000);

      const err = await rejected;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("socket hang up");

      // DEFAULT_AGENT_STEP_RETRY.maxAttempts === 2
      expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry after the abort signal is set by the step deadline", async () => {
    const abortController = new AbortController();
    mockedExecuteWithAgentSDK.mockImplementation(async (_prompt, options) => {
      abortController.abort(new Error('Step "test-step" timed out after 1000ms'));
      const reason = options?.abortController?.signal.reason;
      throw reason instanceof Error ? reason : new Error("aborted");
    });

    const step = makeStep(projectDir, {
      retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 },
    });

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
    ).rejects.toThrow("timed out");

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);
  });

  describe("tool telemetry artifact", () => {
    it("writes tool-telemetry.json when tool calls were recorded via SDK messages", async () => {
      mockedExecuteWithAgentSDK.mockImplementation(async (_prompt, options) => {
        options?.onMessage?.({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "tu-1", name: "shell", input: {} },
              { type: "tool_use", id: "tu-2", name: "file_read", input: {} },
            ],
          },
        } as never);
        options?.onMessage?.({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "tu-1", content: "ok", is_error: false },
            ],
          },
        } as never);
        options?.onMessage?.({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "tu-2", content: "not found", is_error: true },
            ],
          },
        } as never);
        return SUCCESS_RESULT;
      });
      mkdirSync(join(projectDir, ".kota", "runs", "run-1", "steps"), { recursive: true });

      await executeAgentStep(
        makeDefinition(),
        makeStep(projectDir),
        makeMetadata(),
        TRIGGER,
        new AbortController(),
        () => {},
        () => {},
        agentConfig,
      );

      const telemetryPath = join(projectDir, ".kota", "runs", "run-1", "steps", "test-step.tool-telemetry.json");
      expect(existsSync(telemetryPath)).toBe(true);
      const data = JSON.parse(readFileSync(telemetryPath, "utf-8"));
      expect(data.summary).toContain("2 tool calls");
      expect(data.tools.shell).toMatchObject({ calls: 1, successes: 1, failures: 0 });
      expect(data.tools.file_read).toMatchObject({ calls: 1, failures: 1, lastError: "not found" });
    });

    it("skips writing when no tool calls were recorded", async () => {
      mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);
      mkdirSync(join(projectDir, ".kota", "runs", "run-1", "steps"), { recursive: true });

      await executeAgentStep(
        makeDefinition(),
        makeStep(projectDir),
        makeMetadata(),
        TRIGGER,
        new AbortController(),
        () => {},
        () => {},
        agentConfig,
      );

      const telemetryPath = join(projectDir, ".kota", "runs", "run-1", "steps", "test-step.tool-telemetry.json");
      expect(existsSync(telemetryPath)).toBe(false);
    });
  });
});

describe("buildAgentPrompt", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-build-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "src", "modules", "test", "workflows", "test"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "modules", "test", "workflows", "test", "prompt.md"),
      "Test prompt.\n",
    );
  });

  it("omits the exposed step outputs section when nothing is exposed", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      {},
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).not.toContain("Exposed step outputs:");
  });

  it("states that the agent should choose its own investigation path", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      {},
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).toContain("There is intentionally no fixed checklist here.");
  });

  it("points high-stakes decisions at the owner-question MCP tool", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      {},
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).toContain(KOTA_OWNER_QUESTIONS_MCP_TOOL);
  });

  it("omits non-exposed step outputs", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition({
        steps: [{ id: "some-step", type: "code", run: async () => ({ ok: true }) }],
      }),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      { "some-step": { counts: { ready: 2 } } },
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).not.toContain("Exposed step outputs:");
  });

  it("omits skipped exposed outputs", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition({
        steps: [
          {
            id: "some-step",
            type: "code",
            run: async () => ({ ok: true }),
            exposeOutputToAgent: true,
          },
        ],
      }),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      { "some-step": { skipped: true } },
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).not.toContain("Exposed step outputs:");
  });

  it("injects explicitly exposed step outputs into prompt", () => {
    const output = { counts: { ready: 3 }, actionableCount: 3 };
    const { prompt } = buildAgentPrompt(
      makeDefinition({
        steps: [
          {
            id: "inspect-ready-queue",
            type: "code",
            run: async () => output,
            exposeOutputToAgent: true,
          },
        ],
      }),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      { "inspect-ready-queue": output },
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).toContain("Exposed step outputs:");
    expect(prompt).toContain('<step id="inspect-ready-queue">');
    expect(prompt).toContain('"ready": 3');
  });

  it("injects multiple exposed step outputs in definition order", () => {
    const outputs = {
      "claim-task": { chosenTaskId: "task-demo" },
      "inspect-queue": { counts: { ready: 2 } },
    };
    const { prompt } = buildAgentPrompt(
      makeDefinition({
        steps: [
          {
            id: "inspect-queue",
            type: "code",
            run: async () => ({ counts: { ready: 2 } }),
            exposeOutputToAgent: true,
          },
          {
            id: "claim-task",
            type: "code",
            run: async () => ({ chosenTaskId: "task-demo" }),
            exposeOutputToAgent: true,
          },
        ],
      }),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      outputs,
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    const inspectIdx = prompt.indexOf('<step id="inspect-queue">');
    const claimIdx = prompt.indexOf('<step id="claim-task">');
    expect(inspectIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeGreaterThan(-1);
    expect(inspectIdx).toBeLessThan(claimIdx);
  });

  it("omits the trigger payload block when the payload is empty", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      TRIGGER,
      projectDir,
      {},
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).not.toContain("Trigger payload:");
  });

  it("includes the trigger payload block when the payload has runtime facts", () => {
    const { prompt } = buildAgentPrompt(
      makeDefinition(),
      makeStep(projectDir),
      makeMetadata(),
      { event: "workflow.completed", payload: { runId: "run-123" } },
      projectDir,
      {},
      KOTA_OWNER_QUESTIONS_MCP_TOOL,
    );
    expect(prompt).toContain("Trigger payload:");
    expect(prompt).toContain('"runId": "run-123"');
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
    try {
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
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts during retry backoff without starting another attempt", async () => {
    vi.useFakeTimers();
    try {
      const abortController = new AbortController();
      const fn = vi.fn().mockRejectedValue(new Error("fail"));

      const promise = withRetry(
        fn,
        { maxAttempts: 2, initialDelayMs: 100, backoffFactor: 1 },
        { abortSignal: abortController.signal },
      );
      const caught = promise.catch((err) => err);

      await Promise.resolve();
      abortController.abort(new Error("stop now"));

      const err = await caught;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("stop now");
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
    const step = makeStep("/test-module-root", { id: "build" });
    const failures = [{ id: "verify-lint", passed: false, output: "error: semicolon", severity: "error" as const }];
    const prompt = buildRepairPrompt(1, 3, failures, step);
    expect(prompt).toContain("repair attempt 1/3");
    expect(prompt).toContain('"build"');
    expect(prompt).toContain("## verify-lint");
    expect(prompt).toContain("error: semicolon");
    expect(prompt).toContain("Fix these issues now");
    expect(prompt).toContain("commit-message.txt");
  });

  it("includes all failures", () => {
    const step = makeStep("/test-module-root");
    const failures = [
      { id: "check-a", passed: false, output: "error A", severity: "error" as const },
      { id: "check-b", passed: false, output: "error B", severity: "error" as const },
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
    mkdirSync(join(projectDir, "src", "modules", "test", "workflows", "test"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "modules", "test", "workflows", "test", "prompt.md"),
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
        definitionPath: "src/modules/test/workflows/test/workflow.ts",
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
      triggerWorkflow: () => Promise.reject(new Error("not implemented")),
    };
  }

  it("happy path: no repair needed when all checks pass", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    const runTool = vi.fn().mockResolvedValue({ content: "all good", is_error: false });
    const context = makeRepairContext(runTool);
    const step = makeStep(projectDir, {
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
    expect(result).toMatchObject({
      output: { content: "done", repairIterations: [] },
      harness: "claude-agent-sdk",
      model: "claude-opus-4-7",
    });
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
    const step = makeStep(projectDir, {
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [{ id: "check-lint", tool: "shell", input: { command: "npm run lint" } }],
      },
    });

    const wrapped = await executeStep(
      makeDefinition(),
      step,
      makeMetadata(),
      TRIGGER,
      context,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    ) as { output: Record<string, unknown>; harness: string; model: string };
    const result = wrapped.output;

    // Initial agent + repair agent = 2 calls
    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
    // First check fails, repair runs, second check passes
    expect(runTool).toHaveBeenCalledTimes(2);

    expect(result.content).toBe("fixed");
    expect(result.turns).toBe(3); // 1 initial + 2 repair
    expect(result.totalCostUsd).toBeCloseTo(0.03); // 0.01 + 0.02
    expect(wrapped.harness).toBe("claude-agent-sdk");
    expect(wrapped.model).toBe("claude-opus-4-7");

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
    const step = makeStep(projectDir, {
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
    ).rejects.toThrow('Repair loop for step "test-step" exhausted repair attempts (2)');

    // Initial agent + 2 repair agents (one per attempt): maxRepairAttempts=2 means 2 repair runs
    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(3);
    // Initial check + 1 post-repair check per attempt = 3 check rounds total
    expect(runTool).toHaveBeenCalledTimes(3);
  });

  it("warning checks do not trigger repair", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    const runTool = vi
      .fn()
      .mockRejectedValue(new Error("advisory warning"));
    const context = makeRepairContext(runTool);
    const step = makeStep(projectDir, {
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [
          {
            id: "warning-check",
            tool: "shell",
            severity: "warning",
            input: { command: "npm test -- warnings" },
          },
        ],
      },
    });

    const wrapped = await executeStep(
      makeDefinition(),
      step,
      makeMetadata(),
      TRIGGER,
      context,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    ) as { output: Record<string, unknown> };
    const result = wrapped.output;

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(result.content).toBe("done");
    expect(result.repairIterations).toEqual([]);
    expect(result.repairWarnings).toMatchObject([{ id: "warning-check", severity: "warning" }]);
  });

  it("supports code-based repair checks", async () => {
    mockedExecuteWithAgentSDK
      .mockResolvedValueOnce(SUCCESS_RESULT)
      .mockResolvedValueOnce({ ...SUCCESS_RESULT, text: "fixed queue", turns: 2, totalCostUsd: 0.02 });

    const codeCheck = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("queue invalid");
      })
      .mockReturnValue({ ok: true });

    const context = makeRepairContext(vi.fn());
    const step = makeStep(projectDir, {
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [
          {
            id: "queue-check",
            type: "code",
            run: codeCheck,
          },
        ],
      },
    });

    const wrapped = await executeStep(
      makeDefinition(),
      step,
      makeMetadata(),
      TRIGGER,
      context,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    ) as { output: Record<string, unknown> };
    const result = wrapped.output;

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
    expect(codeCheck).toHaveBeenCalledTimes(2);
    expect(result.content).toBe("fixed queue");
  });

  it("reuses agent model overrides and thinking settings during repair attempts", async () => {
    mockedExecuteWithAgentSDK
      .mockResolvedValueOnce(SUCCESS_RESULT)
      .mockResolvedValueOnce({ ...SUCCESS_RESULT, text: "fixed", turns: 2, totalCostUsd: 0.02 });

    const runTool = vi
      .fn()
      .mockRejectedValueOnce(new Error("lint failed"))
      .mockResolvedValue({ content: "lint passed", is_error: false });

    const context = makeRepairContext(runTool);
    const step = makeStep(projectDir, {
      agentName: "builder",
      thinkingEnabled: true,
      thinkingBudget: 4096,
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [{ id: "check-lint", tool: "shell", input: { command: "npm run lint" } }],
      },
    });

    const cfg = {
      ...agentConfig,
      config: {
        model: "fallback-model",
        agentModels: { builder: "builder-model" },
      } as never,
    };

    await executeStep(
      makeDefinition(),
      step,
      makeMetadata(),
      TRIGGER,
      context,
      new AbortController(),
      () => {},
      () => {},
      cfg,
    );

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
    expect(mockedExecuteWithAgentSDK.mock.calls[0]?.[1]).toMatchObject({
      model: "builder-model",
      thinkingEnabled: true,
      thinkingBudget: 4096,
    });
    expect(mockedExecuteWithAgentSDK.mock.calls[1]?.[1]).toMatchObject({
      model: "builder-model",
      thinkingEnabled: true,
      thinkingBudget: 4096,
    });
  });

  it("skips later-phase checks when an earlier phase fails", async () => {
    mockedExecuteWithAgentSDK
      .mockResolvedValueOnce(SUCCESS_RESULT) // initial agent run
      .mockResolvedValueOnce({ ...SUCCESS_RESULT, text: "fixed", turns: 2, totalCostUsd: 0.02 }); // repair agent

    let phase1Calls = 0;
    const phase1Check = vi
      .fn()
      .mockImplementationOnce(() => {
        phase1Calls++;
        throw new Error("lint error");
      })
      .mockImplementation(() => {
        phase1Calls++;
        return "OK";
      });

    const phase2Check = vi.fn().mockReturnValue("OK");

    const context = makeRepairContext(vi.fn());
    const step = makeStep(projectDir, {
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [
          { id: "lint-check", type: "code", run: phase1Check },
          { id: "critic-check", type: "code", phase: 1, run: phase2Check },
        ],
      },
    });

    const wrapped = await executeStep(
      makeDefinition(),
      step,
      makeMetadata(),
      TRIGGER,
      context,
      new AbortController(),
      () => {},
      () => {},
      agentConfig,
    ) as { output: Record<string, unknown> };
    const result = wrapped.output;

    // Phase 1 failed initially → phase 2 (critic) should NOT have run on first check
    // After repair, phase 1 passes → phase 2 runs
    expect(phase1Calls).toBe(2); // once failing, once passing
    expect(phase2Check).toHaveBeenCalledTimes(1); // only after phase 1 passed
    expect(result.content).toBe("fixed");
  });

  it("stops repair loop when abort signal is already set", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    const codeCheck = vi.fn().mockImplementation(() => {
      throw new Error("always fails");
    });

    const context = makeRepairContext(vi.fn());
    const abortController = new AbortController();
    abortController.abort(new Error("step timed out"));

    const step = makeStep(projectDir, {
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [{ id: "check-build", type: "code", run: codeCheck }],
      },
    });

    await expect(
      executeStep(
        makeDefinition(),
        step,
        makeMetadata(),
        TRIGGER,
        context,
        abortController,
        () => {},
        () => {},
        agentConfig,
      ),
    ).rejects.toThrow("step timed out");

    expect(mockedExecuteWithAgentSDK).not.toHaveBeenCalled();
    expect(codeCheck).not.toHaveBeenCalled();
  });

  it("stops repair loop mid-iteration when abort signal fires", async () => {
    const abortController = new AbortController();

    mockedExecuteWithAgentSDK
      .mockResolvedValueOnce(SUCCESS_RESULT)
      .mockImplementation(async () => {
        abortController.abort(new Error("step timed out"));
        return { ...SUCCESS_RESULT, text: "partial fix", turns: 2, totalCostUsd: 0.02 };
      });

    const codeCheck = vi.fn().mockImplementation(() => {
      throw new Error("still fails");
    });

    const context = makeRepairContext(vi.fn());
    const step = makeStep(projectDir, {
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [{ id: "check-build", type: "code", run: codeCheck }],
      },
    });

    const wrapped = await executeStep(
      makeDefinition(),
      step,
      makeMetadata(),
      TRIGGER,
      context,
      abortController,
      () => {},
      () => {},
      agentConfig,
    ) as { output: Record<string, unknown> };
    const result = wrapped.output;

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
    expect(codeCheck).toHaveBeenCalledTimes(1);
    const iterations = result.repairIterations as Array<Record<string, unknown>>;
    expect(iterations).toHaveLength(1);
  });
});

describe("executeEmitStep — notify config", () => {
  function makeEmitContext(): Parameters<typeof executeEmitStep>[1] {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    return {
      emit: (event: string, payload: Record<string, unknown>) => emitted.push({ event, payload }),
      _emitted: emitted,
    } as unknown as Parameters<typeof executeEmitStep>[1] & { _emitted: typeof emitted };
  }

  function makeEmitStep(event: string): WorkflowEmitStep {
    return { id: "emit-step", type: "emit", event };
  }

  it("emits workflow.build.committed by default (no notify config)", async () => {
    const ctx = makeEmitContext();
    const emitted = (ctx as unknown as { _emitted: Array<{ event: string }> })._emitted;
    await executeEmitStep(makeEmitStep("workflow.build.committed"), ctx);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe("workflow.build.committed");
  });

  it("suppresses workflow.build.committed when onSuccess is false", async () => {
    const ctx = makeEmitContext();
    const emitted = (ctx as unknown as { _emitted: Array<{ event: string }> })._emitted;
    const notify: WorkflowNotifyConfig = { onSuccess: false };
    const result = await executeEmitStep(makeEmitStep("workflow.build.committed"), ctx, notify);
    expect(emitted).toHaveLength(0);
    expect(result).toMatchObject({ event: "workflow.build.committed", suppressed: true });
  });

  it("does not suppress workflow.build.committed when onSuccess is true", async () => {
    const ctx = makeEmitContext();
    const emitted = (ctx as unknown as { _emitted: Array<{ event: string }> })._emitted;
    const notify: WorkflowNotifyConfig = { onSuccess: true };
    await executeEmitStep(makeEmitStep("workflow.build.committed"), ctx, notify);
    expect(emitted).toHaveLength(1);
  });

  it("does not suppress non-notification emit events even when notify config is set", async () => {
    const ctx = makeEmitContext();
    const emitted = (ctx as unknown as { _emitted: Array<{ event: string }> })._emitted;
    const notify: WorkflowNotifyConfig = { onSuccess: false };
    await executeEmitStep(makeEmitStep("custom.event.done"), ctx, notify);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe("custom.event.done");
  });
});

describe("classifyAgentRuntimeFailure", () => {
  it("classifies 429 HTTP status as non-retryable rate_limit", () => {
    expect(classifyAgentRuntimeFailure({ message: "", status: 429 })).toEqual({
      kind: "rate_limit",
      retryable: false,
    });
  });

  it("classifies 401 and 403 HTTP status as non-retryable auth", () => {
    expect(classifyAgentRuntimeFailure({ message: "", status: 401 })).toEqual({
      kind: "auth",
      retryable: false,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 403 })).toEqual({
      kind: "auth",
      retryable: false,
    });
  });

  it("classifies 5xx and 408 HTTP statuses as retryable provider", () => {
    expect(classifyAgentRuntimeFailure({ message: "", status: 500 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 502 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 503 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 529 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 408 })).toEqual({
      kind: "provider",
      retryable: true,
    });
  });

  it("classifies Node network error codes as retryable provider", () => {
    for (const code of ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EPIPE"]) {
      expect(classifyAgentRuntimeFailure({ message: "", code })).toEqual({
        kind: "provider",
        retryable: true,
      });
    }
  });

  it("parses API Error: <status> from SDK result text", () => {
    expect(
      classifyAgentRuntimeFailure({
        message:
          'Claude Code returned an error result: API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}',
      }),
    ).toEqual({ kind: "provider", retryable: true });
    expect(
      classifyAgentRuntimeFailure({ message: "API Error: 529 overloaded" }),
    ).toEqual({ kind: "provider", retryable: true });
    expect(
      classifyAgentRuntimeFailure({ message: "API Error: 429" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
  });

  it("classifies rate-limit and auth CLI text markers", () => {
    expect(
      classifyAgentRuntimeFailure({ message: "you've hit your limit for today" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "rate limit exceeded" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "quota exceeded" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "not logged in" }),
    ).toEqual({ kind: "auth", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "please run /login" }),
    ).toEqual({ kind: "auth", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "unauthorized" }),
    ).toEqual({ kind: "auth", retryable: false });
  });

  it("does not classify max-turns SDK subtype (step fails hard)", () => {
    expect(
      classifyAgentRuntimeFailure({
        message: "Agent exhausted max turns",
        subtype: "error_max_turns",
      }),
    ).toBeNull();
  });

  it("never classifies AbortError (propagated as-is)", () => {
    expect(
      classifyAgentRuntimeFailure({
        message: "aborted",
        errorName: "AbortError",
        code: "ECONNRESET",
      }),
    ).toBeNull();
  });

  it("returns null for unrecognized errors", () => {
    expect(
      classifyAgentRuntimeFailure({ message: "something unexpected happened" }),
    ).toBeNull();
    expect(classifyAgentRuntimeFailure({ message: "" })).toBeNull();
    // Broad fuzzy matches that used to retry no longer do.
    expect(
      classifyAgentRuntimeFailure({ message: "network error occurred" }),
    ).toBeNull();
    expect(
      classifyAgentRuntimeFailure({ message: "timed out after 30s" }),
    ).toBeNull();
    expect(
      classifyAgentRuntimeFailure({ message: "internal server error" }),
    ).toBeNull();
  });
});
