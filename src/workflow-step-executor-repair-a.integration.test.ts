// biome-ignore-all lint/correctness/noUnusedImports: split integration suites share one runtime fixture
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { EventBus } from "#core/events/event-bus.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { readOnlyLocalEffect } from "#core/tools/effect.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
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
import { unexpectedWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import {
  KOTA_OWNER_QUESTIONS_MCP_SERVER,
  KOTA_OWNER_QUESTIONS_MCP_TOOL,
} from "#modules/claude-agent-harness/kota-tools-mcp.js";
import { createTestTransactionalRunState } from "./core/workflow/testing/run-context-fixture.js";
import {
  makeDefinition,
  makeMetadata,
  makeStep,
  mockedExecuteWithAgentSDK,
  SUCCESS_RESULT,
  TRIGGER,
} from "./workflow-step-executor-fixture.integration.js";

const REPAIR_CHECK_TOOL = "repair_check_a_fixture";

describe("executeStep repair loop", () => {
  let scopeRoot: string;
  let agentConfig: AgentStepConfig;

  beforeAll(() => {
    registerTool(
      {
        name: REPAIR_CHECK_TOOL,
        description: "Read-only repair check fixture",
        input_schema: { type: "object", properties: {} },
      },
      async () => ({ content: "unused registry runner" }),
      undefined,
      { effect: readOnlyLocalEffect() },
    );
  });

  afterAll(() => {
    deregisterTool(REPAIR_CHECK_TOOL);
  });

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-repair-loop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(scopeRoot, "src", "modules", "test", "workflows", "test"), { recursive: true });
    writeFileSync(
      join(scopeRoot, "src", "modules", "test", "workflows", "test", "prompt.md"),
      "Test prompt.\n",
    );
    agentConfig = { scopeRoot };
    mockedExecuteWithAgentSDK.mockReset();
  });

  function makeRepairContext(runTool: WorkflowStepContext["runTool"]): WorkflowStepContext {
    return {
      scopeId: "test-scope",
      scopeRoot,
      workspaceRoot: scopeRoot,
      stateDir: join(scopeRoot, ".kota"),
      state: createTestTransactionalRunState(),
      agentRuntime: resolveAgentRuntime(undefined),
      workflow: {
        name: "test",
        definitionPath: "src/modules/test/workflows/test/workflow.ts",
        runId: "run-1",
        runDir: ".kota/runs/run-1",
        runDirPath: `${scopeRoot}/.kota/runs/run-1`,
      },
      trigger: TRIGGER,
      previousOutput: null,
      stepOutputs: {},
      stepResults: {},
      stepOutputList: [],
      runAgentHarness: createWorkflowAgentHarnessRunner(),
      runCommand: unexpectedWorkflowCommandRun,
      runTool,
      emit: () => {},
      requestRestart: () => {},
      readPrompt: () => "",
      readRuntimeState: () => ({
        completedRuns: 0,
        pendingRuns: [],
        workflows: {},
      }),
      reportProgress: () => {},
      triggerWorkflow: () => Promise.reject(new Error("not implemented")),
    };
  }

  it("happy path: no repair needed when all checks pass", async () => {
    mockedExecuteWithAgentSDK.mockResolvedValue(SUCCESS_RESULT);

    const runTool = vi.fn().mockResolvedValue({ content: "all good", is_error: false });
    const context = makeRepairContext(runTool);
    const step = makeStep(scopeRoot, {
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [{ id: "check-lint", tool: REPAIR_CHECK_TOOL, input: { command: "npm run lint" } }],
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
      new EventBus(),
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
    const step = makeStep(scopeRoot, {
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [{ id: "check-lint", tool: REPAIR_CHECK_TOOL, input: { command: "npm run lint" } }],
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
      new EventBus(),
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

  it("omits message capture during repair attempts for non-streaming harnesses", async () => {
    const harnessCalls: Array<{ hasOnMessage: boolean }> = [];
    const harness: AgentHarness = {
      name: "repair-loop-nostream-test",
      description: "test-only non-streaming repair harness",
      supportsMultiTurn: true,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      async run(options) {
        harnessCalls.push({ hasOnMessage: "onMessage" in options });
        if (options.onMessage !== undefined) {
          throw new Error("non-stream harness received onMessage");
        }
        return {
          ...SUCCESS_RESULT,
          text: harnessCalls.length === 1 ? "done" : "fixed",
        };
      },
    };
    registerAgentHarness(harness);

    const runTool = vi
      .fn()
      .mockRejectedValueOnce(new Error("lint error: missing semicolon"))
      .mockResolvedValue({ content: "lint passed", is_error: false });

    const context = makeRepairContext(runTool);
    const step = makeStep(scopeRoot, {
      harness: "repair-loop-nostream-test",
      model: "test-model",
      repairLoop: {
        maxRepairAttempts: 2,
        checks: [{ id: "check-lint", tool: REPAIR_CHECK_TOOL, input: { command: "pnpm lint" } }],
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
      new EventBus(),
    ) as { output: Record<string, unknown>; harness: string; model: string };

    expect(wrapped.output.content).toBe("fixed");
    expect(wrapped.harness).toBe("repair-loop-nostream-test");
    expect(wrapped.model).toBe("test-model");
    expect(harnessCalls).toEqual([{ hasOnMessage: false }, { hasOnMessage: false }]);
  });

  it("preserves repair telemetry with a classified provider backoff signal", async () => {
    // Repair-loop runtime failures retain the repair result while nesting the
    // classified backoff signal that the run executor applies to dispatch.
    mockedExecuteWithAgentSDK
      .mockResolvedValueOnce(SUCCESS_RESULT) // initial agent run
      .mockResolvedValueOnce({
        ...SUCCESS_RESULT,
        isError: true,
        text:
          "API Error: 529 Authentication service is temporarily unavailable. Retry the request.",
      });

    const runTool = vi
      .fn()
      .mockRejectedValue(new Error("lint error: missing semicolon"));

    const context = makeRepairContext(runTool);
    const step = makeStep(scopeRoot, {
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [{ id: "check-lint", tool: REPAIR_CHECK_TOOL, input: { command: "npm run lint" } }],
      },
    });

    let thrown: unknown;
    try {
      await executeStep(
        makeDefinition(),
        step,
        makeMetadata(),
        TRIGGER,
        context,
        new AbortController(),
        () => {},
        () => {},
        agentConfig,
        new EventBus(),
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RepairAgentRuntimeError);
    expect(thrown).toMatchObject({
      kind: "provider",
      retryable: false,
      message: expect.stringContaining('Repair agent for step "test-step" failed'),
      output: {
        repairIterations: [{
          agentResponse: expect.stringContaining("API Error: 529"),
          agentError: expect.stringContaining("API Error: 529"),
        }],
      },
    });
  });

});
