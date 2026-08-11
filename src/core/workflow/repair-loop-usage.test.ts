import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { RepairLoopError, runAgentRepairLoop } from "./repair-loop.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import type { AgentStepResult } from "./steps/step-executor-agent.js";
import { createWorkflowAgentHarnessRunner } from "./steps/workflow-agent-harness-runner.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("repair-loop usage", () => {
  it("retains usage and backoff when a resumed repair result is an error", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-repair-usage-"));
    roots.push(projectDir);
    writeFileSync(join(projectDir, "prompt.md"), "Repair.\n", "utf8");
    mkdirSync(join(projectDir, ".kota", "runs", "run-1"), { recursive: true });
    const harnessName = `repair-usage-${Date.now()}`;
    const resumedSessionIds: Array<string | undefined> = [];
    registerAgentHarness({
      name: harnessName,
      description: "repair usage fixture",
      supportsMultiTurn: true,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options: AgentHarnessRunOptions) => {
        resumedSessionIds.push(options.resumeSessionId);
        return {
          text: "Individual quota reached. Resets in 1h.",
          streamedText: "",
          turns: 1,
          inputTokens: 31,
          outputTokens: 4,
          sessionId: "attempt-1",
          subtype: "antigravity_cli_error",
          isError: true,
        };
      },
    });
    const step: WorkflowAgentStep = {
      id: "build",
      type: "agent",
      harness: harnessName,
      model: "fixture-model",
      effort: "low",
      autonomyMode: "autonomous",
      moduleRoot: projectDir,
      promptPath: "prompt.md",
      repairLoop: {
        maxRepairAttempts: 1,
        checks: [{
          id: "fail-once",
          type: "code",
          run: () => {
            throw new Error("needs repair");
          },
        }],
      },
    };
    const metadata: WorkflowRunMetadata = {
      id: "run-1",
      workflow: "fixture",
      definitionPath: "workflow.ts",
      trigger: { event: "runtime.idle", schemaRef: null, payload: {} },
      startedAt: "2026-08-11T00:00:00.000Z",
      status: "running",
      runDir: ".kota/runs/run-1",
      steps: [],
    };
    const context = {
      projectDir,
      agentRuntime: resolveAgentRuntime(undefined),
      workflow: {
        name: "fixture",
        definitionPath: "workflow.ts",
        runId: "run-1",
        runDir: metadata.runDir,
        runDirPath: join(projectDir, metadata.runDir),
      },
      trigger: metadata.trigger,
      previousOutput: undefined,
      stepOutputs: {},
      stepResults: {},
      stepOutputList: [],
      runAgentHarness: createWorkflowAgentHarnessRunner(undefined),
      runTool: async () => ({ content: "unused" }),
      emit: vi.fn(),
      requestRestart: vi.fn(),
      readPrompt: () => "Repair.\n",
      readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
      reportProgress: vi.fn(),
      triggerWorkflow: async () => ({ runId: "unused", status: "queued" as const }),
    } satisfies WorkflowStepContext;
    const initialResult: AgentStepResult = {
      output: {
        content: "initial",
        turns: 1,
        totalCostUsd: 0,
        inputTokens: 10,
        outputTokens: 2,
        sessionId: "attempt-1",
      },
      harness: harnessName,
      model: "fixture-model",
      trajectoryDiagnostics: {
        artifactPath: ".kota/runs/run-1/steps/build.trajectory-diagnostics.json",
        warningCount: 0,
        unsupportedTrajectoryCount: 0,
        missingStreamingFramesCount: 0,
        missingFinalVerificationAfterEditCount: 0,
        repeatedIdenticalFailingCommandCount: 0,
        editAfterSuccessfulVerificationCount: 0,
        longPreambleWithoutTaskTouchCount: 0,
      },
      trajectoryMessages: [],
      preStepMutatedPaths: [],
    };

    await expect(runAgentRepairLoop(
      step,
      initialResult,
      context,
      metadata,
      new AbortController(),
      vi.fn(),
      { projectDir },
    )).rejects.toMatchObject({
      name: RepairLoopError.name,
      kind: undefined,
      agentBackoff: {
        kind: "rate_limit",
        retryable: false,
      },
      output: {
        inputTokens: 41,
        outputTokens: 6,
        sessionId: "attempt-1",
        repairIterations: [{
          agentResponse: "Individual quota reached. Resets in 1h.",
          agentInputTokens: 31,
          agentOutputTokens: 4,
          agentSessionId: "attempt-1",
          agentError: expect.stringContaining("Individual quota reached"),
        }],
      },
    });
    expect(resumedSessionIds).toEqual(["attempt-1"]);
  });
});
