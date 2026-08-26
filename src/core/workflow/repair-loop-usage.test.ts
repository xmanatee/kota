import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import { unpricedAgentUsage } from "#core/agent-harness/usage.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { runAgentRepairLoop } from "./repair-loop.js";
import type { WorkflowRunMetadata, WorkflowStepContext } from "./run-types.js";
import type { WorkflowAgentStep } from "./step-types.js";
import type { AgentStepResult } from "./steps/step-executor-agent.js";
import { AgentStepRuntimeError } from "./steps/step-executor-retry.js";
import { createWorkflowAgentHarnessRunner } from "./steps/workflow-agent-harness-runner.js";
import { createTestTransactionalRunState } from "./testing/run-context-fixture.js";
import { createWorkflowCommandRunner } from "./workflow-command.js";

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
          usage: unpricedAgentUsage(31, 4),
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
      scopeDir: projectDir,
      stateDir: join(projectDir, ".kota"),
      state: createTestTransactionalRunState(),
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
      runCommand: createWorkflowCommandRunner({ cwd: projectDir }),
      runTool: async () => ({ content: "unused" }),
      emit: vi.fn(),
      requestRestart: vi.fn(),
      readPrompt: () => "Repair.\n",
      readRuntimeState: () => ({ completedRuns: 0, workflows: {} }),
      reportProgress: vi.fn(),
      triggerWorkflow: async () => ({ runId: "unused", status: "queued" as const }),
    } satisfies WorkflowStepContext;
    const initialResult: AgentStepResult = {
      output: {
        content: "initial",
        turns: 1,
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

    const onUsage = vi.fn();
    await expect(runAgentRepairLoop(
      step,
      initialResult,
      context,
      metadata,
      new AbortController(),
      vi.fn(),
      { projectDir, onUsage },
    )).rejects.toMatchObject({
      name: AgentStepRuntimeError.name,
      kind: "rate_limit",
      retryable: false,
      output: {
        sessionId: "attempt-1",
        repairIterations: [{
          agentResponse: "Individual quota reached. Resets in 1h.",
          agentSessionId: "attempt-1",
          agentError: expect.stringContaining("Individual quota reached"),
        }],
      },
    });
    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith(unpricedAgentUsage(31, 4));
    expect(resumedSessionIds).toEqual(["attempt-1"]);
  });

  it("starts a fresh repair call when the harness declares resume unsupported", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-repair-fresh-session-"));
    roots.push(projectDir);
    writeFileSync(join(projectDir, "prompt.md"), "Repair.\n", "utf8");
    mkdirSync(join(projectDir, ".kota", "runs", "run-2"), { recursive: true });
    const harnessName = `repair-fresh-session-${Date.now()}`;
    const receivedSessionIds: Array<string | undefined> = [];
    registerAgentHarness({
      name: harnessName,
      description: "repair fresh-session fixture",
      supportsMultiTurn: true,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      unsupportedRunOptions: [{
        runOption: "resumeSessionId",
        option: "resumeSessionId",
        reason: "fixture harness starts a fresh process for each call",
      }],
      run: async (options: AgentHarnessRunOptions) => {
        receivedSessionIds.push(options.resumeSessionId);
        return {
          text: "repair complete",
          streamedText: "repair complete",
          turns: 1,
          usage: unpricedAgentUsage(20, 3),
          sessionId: "fresh-repair-session",
          isError: false,
        };
      },
    });
    let checkRuns = 0;
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
            checkRuns += 1;
            if (checkRuns === 1) throw new Error("needs repair");
            return "ok";
          },
        }],
      },
    };
    const metadata: WorkflowRunMetadata = {
      id: "run-2",
      workflow: "fixture",
      definitionPath: "workflow.ts",
      trigger: { event: "runtime.idle", schemaRef: null, payload: {} },
      startedAt: "2026-08-13T00:00:00.000Z",
      status: "running",
      runDir: ".kota/runs/run-2",
      steps: [],
    };
    const context = {
      projectDir,
      scopeDir: projectDir,
      stateDir: join(projectDir, ".kota"),
      state: createTestTransactionalRunState(),
      agentRuntime: resolveAgentRuntime(undefined),
      workflow: {
        name: "fixture",
        definitionPath: "workflow.ts",
        runId: "run-2",
        runDir: metadata.runDir,
        runDirPath: join(projectDir, metadata.runDir),
      },
      trigger: metadata.trigger,
      previousOutput: undefined,
      stepOutputs: {},
      stepResults: {},
      stepOutputList: [],
      runAgentHarness: createWorkflowAgentHarnessRunner(undefined),
      runCommand: createWorkflowCommandRunner({ cwd: projectDir }),
      runTool: async () => ({ content: "unused" }),
      emit: vi.fn(),
      requestRestart: vi.fn(),
      readPrompt: () => "Repair.\n",
      readRuntimeState: () => ({ completedRuns: 0, workflows: {} }),
      reportProgress: vi.fn(),
      triggerWorkflow: async () => ({ runId: "unused", status: "queued" as const }),
    } satisfies WorkflowStepContext;
    const initialResult: AgentStepResult = {
      output: {
        content: "initial",
        turns: 1,
        sessionId: "initial-session",
      },
      harness: harnessName,
      model: "fixture-model",
      trajectoryDiagnostics: {
        artifactPath: ".kota/runs/run-2/steps/build.trajectory-diagnostics.json",
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

    const result = await runAgentRepairLoop(
      step,
      initialResult,
      context,
      metadata,
      new AbortController(),
      vi.fn(),
      { projectDir },
    );

    expect(receivedSessionIds).toEqual([undefined]);
    expect(result.output).toMatchObject({
      content: "repair complete",
      sessionId: "fresh-repair-session",
      repairIterations: [{ attempt: 1, agentSessionId: "fresh-repair-session" }],
    });
  });
});
