import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pricedAgentUsage } from "#core/agent-harness/index.js";
import { EventBus } from "#core/events/event-bus.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import type {
  WorkflowStepContext,
} from "#core/workflow/run-types.js";
import type { AgentStepConfig } from "#core/workflow/steps/step-executor.js";
import {
  executeStep,
} from "#core/workflow/steps/step-executor.js";
import { createWorkflowAgentHarnessRunner } from "#core/workflow/steps/workflow-agent-harness-runner.js";
import { unexpectedWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { createTestTransactionalRunState } from "./core/workflow/testing/run-context-fixture.js";
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
      scopeDir: projectDir,
      stateDir: join(projectDir, ".kota"),
      state: createTestTransactionalRunState(),
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

  it("skips later-phase checks when an earlier phase fails", async () => {
    mockedExecuteWithAgentSDK
      .mockResolvedValueOnce(SUCCESS_RESULT) // initial agent run
      .mockResolvedValueOnce({
        ...SUCCESS_RESULT,
        text: "fixed",
        turns: 2,
        usage: pricedAgentUsage(undefined, undefined, 0.02),
      }); // repair agent

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
      new EventBus(),
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
        new EventBus(),
      ),
    ).rejects.toThrow("step timed out");

    expect(mockedExecuteWithAgentSDK).not.toHaveBeenCalled();
    expect(codeCheck).not.toHaveBeenCalled();
  });

  it("rejects a repair iteration aborted before its result can be accepted", async () => {
    const abortController = new AbortController();

    mockedExecuteWithAgentSDK
      .mockResolvedValueOnce(SUCCESS_RESULT)
      .mockImplementation(async () => {
        abortController.abort(new Error("step timed out"));
        return {
          ...SUCCESS_RESULT,
          text: "partial fix",
          turns: 2,
          usage: pricedAgentUsage(undefined, undefined, 0.02),
        };
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
        new EventBus(),
      ),
    ).rejects.toThrow("step timed out");

    expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
    expect(codeCheck).toHaveBeenCalledTimes(1);
  });
});
