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
      agentRuntime: resolveAgentRuntime(undefined),
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
      runAgentHarness: createWorkflowAgentHarnessRunner(
        agentConfig.agentRunLimiter,
      ),
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
        new EventBus(),
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
      new EventBus(),
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
      new EventBus(),
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
      new EventBus(),
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

});
