// biome-ignore-all lint/correctness/noUnusedImports: split integration suites share one runtime fixture
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { EventBus } from "#core/events/event-bus.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { RepairAgentRuntimeError } from "#core/workflow/repair-loop.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepContext,
} from "#core/workflow/run-types.js";
import type { WorkflowNotifyConfig } from "#core/workflow/step-input-base.js";
import type { WorkflowAgentStep, WorkflowEmitStep, WorkflowToolStep } from "#core/workflow/step-types.js";
import type { AgentStepConfig } from "#core/workflow/steps/step-executor.js";
import {
  buildAgentPrompt,
  buildRepairPrompt,
  executeAgentStep,
  executeEmitStep,
  executeStep,
  executeToolStep,
  withRetry,
} from "#core/workflow/steps/step-executor.js";
import { classifyAgentRuntimeFailure } from "#core/workflow/steps/step-executor-retry.js";
import { createWorkflowAgentHarnessRunner } from "#core/workflow/steps/workflow-agent-harness-runner.js";
import {
  KOTA_OWNER_QUESTIONS_MCP_SERVER,
  KOTA_OWNER_QUESTIONS_MCP_TOOL,
} from "#modules/claude-agent-harness/kota-tools-mcp.js";
import {
  makeDefinition,
  makeMetadata,
  makeStep,
  mockedExecuteWithAgentSDK,
  SUCCESS_RESULT,
  TRIGGER,
} from "./workflow-step-executor-fixture.integration.js";

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
