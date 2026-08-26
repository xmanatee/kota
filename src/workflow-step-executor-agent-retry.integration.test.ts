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

describe("executeAgentStep", () => {
  let scopeRoot: string;
  let agentConfig: AgentStepConfig;

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-step-executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(scopeRoot, "src", "modules", "test", "workflows", "test"), { recursive: true });
    writeFileSync(
      join(scopeRoot, "src", "modules", "test", "workflows", "test", "prompt.md"),
      "Test prompt.\n",
    );
    agentConfig = { scopeRoot };
    mockedExecuteWithAgentSDK.mockReset();
  });

  it("retries classified transient failures and succeeds on second attempt", async () => {
    const networkError = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    mockedExecuteWithAgentSDK
      .mockRejectedValueOnce(networkError)
      .mockResolvedValue(SUCCESS_RESULT);

    const logs: string[] = [];
    const step = makeStep(scopeRoot, {
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
    const step = makeStep(scopeRoot, {
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

    const step = makeStep(scopeRoot, {
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

      const step = makeStep(scopeRoot); // no retry — default applies implicitly

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

    const step = makeStep(scopeRoot, {
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

});
