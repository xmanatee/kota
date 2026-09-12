import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import type { RunContext } from "./run-context.js";
import { projectWorkflowRunMetadataForStorage } from "./run-evidence.js";
import { executeWorkflowRun } from "./run-executor.js";
import {
  AGENT_OK_RESULT,
  createRunExecutorTestFixture,
  makeAgentStep,
  makeDefinition,
  makeRunContext,
  type RunExecutorTestFixture,
  registerWorkflowScenarioDriver,
  TRIGGER,
} from "./run-executor-test-fixture.js";
import type { WorkflowCommandRunner } from "./workflow-command.js";

let fixture: RunExecutorTestFixture;

beforeEach(() => {
  fixture = createRunExecutorTestFixture();
});

afterEach(() => {
  fixture.dispose();
});

describe("continueOnFailure", () => {
  it("run aborts normally when a step without continueOnFailure fails", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        {
          id: "critical-step",
          type: "code",
          run: () => {
            executed.push("critical-step");
            throw new Error("critical failure");
          },
        },
        {
          id: "unreachable-step",
          type: "code",
          run: () => {
            executed.push("unreachable-step");
          },
        },
      ],
    });

    const completed: unknown[] = [];
    fixture.bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: fixture.runContext,
      bus: fixture.bus,
      store: fixture.store,
      log: fixture.log,
    });
    const result = await promise;

    expect(executed).toEqual(["critical-step"]);
    expect(result.metadata.status).toBe("failed");
    expect(completed).toEqual([]);
  });

  it("run finishes with success when no steps fail", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "normal-step",
          type: "code",
          continueOnFailure: true,
          run: () => "ok",
        },
      ],
    });

    const completed: unknown[] = [];
    fixture.bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: fixture.runContext,
      bus: fixture.bus,
      store: fixture.store,
      log: fixture.log,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(completed).toEqual([]);
  });

  it("continues with the failed result and persists a warning without publishing completion", async () => {
    const completed: unknown[] = [];
    fixture.bus.on("workflow.completed", (payload) => completed.push(payload));
    const definition = makeDefinition({
      steps: [
        {
          id: "optional-step",
          type: "code",
          continueOnFailure: true,
          run: () => { throw new Error("non-critical"); },
        },
        {
          id: "check-step",
          type: "code",
          run: (ctx) => ctx.stepResults["optional-step"],
        },
      ],
    });

    const result = await fixture.execute(definition).promise;
    const failedStep = {
      id: "optional-step",
      status: "failed",
      continueOnFailure: true,
      error: "non-critical",
    };
    expect(result.metadata.status).toBe("completed-with-warnings");
    expect(result.metadata.steps).toHaveLength(2);
    expect(result.metadata.steps[1]).toMatchObject({
      status: "success",
      output: failedStep,
    });
    expect(fixture.store.getRun(result.metadata.id)?.steps[0]).toMatchObject(failedStep);
    expect(completed).toEqual([]);
  });
});

const runDirectTestCommand: WorkflowCommandRunner = async (input) => {
  const args = [...(input.args ?? [])];
  let stdout = "";
  try {
    stdout = execFileSync(input.command, args, {
      cwd: input.cwd,
      encoding: "utf8",
    });
  } catch (error) {
    const failed = error as { status?: number; stdout?: Buffer | string };
    if (
      failed.status !== 1 ||
      input.command !== "git" ||
      !args.includes("--no-index")
    ) {
      throw error;
    }
    stdout = Buffer.isBuffer(failed.stdout)
      ? failed.stdout.toString("utf8")
      : (failed.stdout ?? "");
  }
  return {
    command: input.command,
    args,
    cwd: input.cwd ?? process.cwd(),
    identity: {
      pid: process.pid,
      processGroupId: process.pid,
      observedCommandHash: "direct-test-command",
      osStartToken: "direct-test-command",
    },
    exitCode: 0,
    stdout: {
      text: stdout,
      totalBytes: Buffer.byteLength(stdout),
      truncated: false,
    },
    stderr: { text: "", totalBytes: 0, truncated: false },
  };
};


describe("continuation checkpoints", () => {
  it("reports failed decomposition checkpoint artifacts for durable attention", async () => {
    const { workspaceRoot, runContext, bus, store, log } = fixture;
    const harness = "workflow-continuation-decompose";
    let attempt = 0;
    registerWorkflowScenarioDriver(harness, async () => {
      attempt += 1;
      writeFileSync(
        join(runContext.sandbox.workspaceDir, "changing.ts"),
        `export const attempt = ${attempt};\n`,
      );
      return AGENT_OK_RESULT;
    });
    execFileSync("git", ["init", "-q", "-b", "main"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.email", "t@example.com"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.name", "test"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    writeFileSync(join(runContext.sandbox.workspaceDir, "seed.txt"), "seed\n");
    execFileSync("git", ["add", "-A"], { cwd: runContext.sandbox.workspaceDir });
    execFileSync("git", ["commit", "-q", "-m", "seed"], {
      cwd: runContext.sandbox.workspaceDir,
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          repairLoop: {
            checks: [{
              id: "critic",
              type: "code",
              run: () => {
                throw new Error("still failing");
              },
            }],
            continuation: {
              collectContext: () => ({
                taskContract: "# Builder task",
                current: { id: "task-a", priority: 1, priorityLabel: "p1" },
                queue: { revision: "one", available: [] },
              }),
              decide: () => {
                const stepsPath = join(workspaceRoot, ".kota", "runs", "test-run", "steps");
                rmSync(stepsPath, { recursive: true, force: true });
                writeFileSync(stepsPath, "block checkpoint writes");
                return {
                  decision: "decompose",
                  rationale: "Repeated changes have not resolved acceptance.",
                  nextAction: "Run the task-domain decomposer.",
                };
              },
              resolveAgentContract: (parent) => ({
                harness: parent.harness,
                model: parent.model,
                effort: parent.effort,
                autonomyMode: "autonomous",
                ownerQuestionAccess: "disabled",
              }),
            },
          },
        }),
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runCommand: runDirectTestCommand,
      runContext,
      bus,
      store,
      log,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.continuation?.decision.decision).toBe("decompose");
    expect(result.continuationCheckpointFailure).toContain(
      "step artifact persistence failed",
    );
  }, 10_000);

  it("suspends an active agent call when a progress frame reveals proven priority work", async () => {
    const { workspaceRoot, runContext, bus, store, log } = fixture;
    const harness = "workflow-continuation-active-yield";
    let completedNativeCall = false;
    let decisionCalls = 0;
    let judgedChangedPaths: readonly string[] = [];
    const resumedSessions: Array<string | undefined> = [];
    registerAgentHarness({
      name: harness,
      description: "native continuation checkpoint test harness",
      supportsMultiTurn: true,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: true,
      toolControl: "native",
      nativeAbortQuarantine: "confirmed-stop",
      run: async (options) => {
        resumedSessions.push(options.resumeSessionId);
        let resolveStopped: () => void = () => {};
        const stopped = new Promise<void>((resolve) => {
          resolveStopped = resolve;
        });
        options.abortQuarantine?.register(() => stopped);
        try {
          options.onSessionId?.("active-session");
          await options.onMessage?.({
            type: "text",
            text: "Working on the current task",
            sessionId: "active-session",
          });
        } finally {
          writeFileSync(
            join(runContext.sandbox.workspaceDir, "quiesced-final.ts"),
            "export const quiesced = true;\n",
          );
          resolveStopped();
        }
        if (!options.abortController?.signal.aborted) completedNativeCall = true;
        return AGENT_OK_RESULT;
      },
    });
    execFileSync("git", ["init", "-q", "-b", "main"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.email", "t@example.com"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.name", "test"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    writeFileSync(join(runContext.sandbox.workspaceDir, "seed.txt"), "seed\n");
    execFileSync("git", ["add", "-A"], { cwd: runContext.sandbox.workspaceDir });
    execFileSync("git", ["commit", "-q", "-m", "seed"], {
      cwd: runContext.sandbox.workspaceDir,
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          repairLoop: {
            checks: [{ id: "complete", type: "code", run: () => "ok" }],
            continuation: {
              collectContext: () => ({
                taskContract: "# Admitted P1 task",
                current: { id: "task-current", priority: 1, priorityLabel: "p1" },
                queue: {
                  revision: "urgent-revision",
                  available: [{
                    id: "task-urgent",
                    title: "Repair runtime safety",
                    priority: 0,
                    priorityLabel: "p0",
                    resource: "task:task-urgent",
                  }],
                },
              }),
              decide: (_context, _step, packet) => {
                decisionCalls += 1;
                judgedChangedPaths = packet.workspace.changedPaths;
                if (decisionCalls === 1) {
                  rmSync(join(workspaceRoot, ".kota", "runs", "test-run"), {
                    recursive: true,
                    force: true,
                  });
                }
                return {
                  decision: "preserve-yield",
                  rationale: "The active P1 call can yield at a durable progress boundary for proven P0 work.",
                  nextAction: "Resume active-session in this same run lineage.",
                };
              },
              resolveAgentContract: (parent) => ({
                harness: parent.harness,
                model: parent.model,
                effort: parent.effort,
                autonomyMode: "autonomous",
                ownerQuestionAccess: "disabled",
              }),
            },
          },
        }),
      ],
    });

    const result = await executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runCommand: runDirectTestCommand,
      runContext,
      bus,
      store,
      log,
    }).promise;

    expect(completedNativeCall).toBe(false);
    expect(judgedChangedPaths).toContain("quiesced-final.ts");
    expect(result.continuation).toMatchObject({
      stepId: "agent",
      decision: { decision: "preserve-yield" },
    });
    expect(result.metadata.steps[0]).toMatchObject({
      status: "failed",
      output: { sessionId: "active-session" },
    });
    if (result.continuation === undefined) {
      throw new Error("missing durable continuation record");
    }
    const resumedBase = makeRunContext(workspaceRoot, 2);
    const resumedRunContext: RunContext = {
      ...resumedBase,
      run: {
        ...resumedBase.run,
        resumeWait: {
          kind: "continuation",
          record: result.continuation,
          lineage: projectWorkflowRunMetadataForStorage(result.metadata),
        },
      },
    };
    const resumed = await executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runCommand: runDirectTestCommand,
      runContext: resumedRunContext,
      bus,
      store,
      log,
    }).promise;

    expect(resumed.metadata.status).toBe("success");
    expect(completedNativeCall).toBe(true);
    expect(decisionCalls).toBe(1);
    expect(resumedSessions).toEqual([undefined, "active-session"]);
    expect(resumed.metadata.continuations).toEqual([result.continuation]);
  }, 10_000);

  it("observes a changed queue revision without a message stream or provider session", async () => {
    const { workspaceRoot, runContext, bus, store, log } = fixture;
    const harness = "workflow-continuation-queue-revision";
    let queueRevision = "baseline-revision";
    let urgentAvailable = false;
    let sawPersistSession = false;
    registerAgentHarness({
      name: harness,
      description: "non-streaming continuation revision test harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options) => {
        sawPersistSession = options.persistSession === true;
        setTimeout(() => {
          queueRevision = "urgent-revision";
          urgentAvailable = true;
        }, 10);
        return await new Promise<never>((_resolve, reject) => {
          options.abortController?.signal.addEventListener(
            "abort",
            () => reject(options.abortController?.signal.reason),
            { once: true },
          );
        });
      },
    });
    execFileSync("git", ["init", "-q", "-b", "main"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.email", "t@example.com"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.name", "test"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    writeFileSync(join(runContext.sandbox.workspaceDir, "seed.txt"), "seed\n");
    execFileSync("git", ["add", "-A"], { cwd: runContext.sandbox.workspaceDir });
    execFileSync("git", ["commit", "-q", "-m", "seed"], {
      cwd: runContext.sandbox.workspaceDir,
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          repairLoop: {
            checks: [{ id: "complete", type: "code", run: () => "ok" }],
            continuation: {
              collectContext: () => ({
                taskContract: "# Admitted P1 task",
                current: { id: "task-current", priority: 1, priorityLabel: "p1" },
                queue: {
                  revision: queueRevision,
                  available: urgentAvailable
                    ? [{
                        id: "task-urgent",
                        title: "Repair runtime safety",
                        priority: 0,
                        priorityLabel: "p0",
                        resource: "task:task-urgent",
                      }]
                    : [],
                },
              }),
              decide: () => ({
                decision: "preserve-yield",
                rationale: "A new canonical queue revision proves available P0 work.",
                nextAction: "Resume this preserved run after the P0 resource completes.",
              }),
              resolveAgentContract: (parent) => ({
                harness: parent.harness,
                model: parent.model,
                effort: parent.effort,
                autonomyMode: "autonomous",
                ownerQuestionAccess: "disabled",
              }),
            },
          },
        }),
      ],
    });

    const result = await executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runCommand: runDirectTestCommand,
      runContext,
      bus,
      store,
      log,
    }).promise;

    expect(sawPersistSession).toBe(true);
    expect(result.continuation).toMatchObject({
      decision: { decision: "preserve-yield" },
      packet: {
        queue: { revision: "urgent-revision" },
        boundaries: ["higher-priority-work"],
      },
    });
    expect(result.metadata.steps[0]).toMatchObject({
      status: "failed",
      output: { content: "", turns: 0 },
    });
  }, 10_000);

  it("observes material workspace expansion for a non-streaming harness when the queue is unchanged", async () => {
    const { workspaceRoot, runContext, bus, store, log } = fixture;
    const harness = "workflow-continuation-workspace-expansion";
    let decisionCalls = 0;
    registerAgentHarness({
      name: harness,
      description: "non-streaming continuation workspace test harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options) => {
        for (let index = 0; index < 4; index += 1) {
          writeFileSync(
            join(runContext.sandbox.workspaceDir, `expanded-${index}.ts`),
            `export const expanded${index} = true;\n`,
          );
        }
        return await new Promise<never>((_resolve, reject) => {
          options.abortController?.signal.addEventListener(
            "abort",
            () => reject(options.abortController?.signal.reason),
            { once: true },
          );
        });
      },
    });
    execFileSync("git", ["init", "-q", "-b", "main"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.email", "t@example.com"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.name", "test"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    writeFileSync(join(runContext.sandbox.workspaceDir, "seed.txt"), "seed\n");
    execFileSync("git", ["add", "-A"], { cwd: runContext.sandbox.workspaceDir });
    execFileSync("git", ["commit", "-q", "-m", "seed"], {
      cwd: runContext.sandbox.workspaceDir,
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          repairLoop: {
            checks: [{ id: "complete", type: "code", run: () => "ok" }],
            continuation: {
              collectContext: () => ({
                taskContract: "# Admitted P1 task",
                current: { id: "task-current", priority: 1, priorityLabel: "p1" },
                queue: { revision: "unchanged-revision", available: [] },
              }),
              decide: () => {
                decisionCalls += 1;
                return {
                  decision: "needs-owner",
                  rationale: "The active implementation materially expanded without a progress stream.",
                  nextAction: "Review the expanded active workspace before continuing.",
                };
              },
              resolveAgentContract: (parent) => ({
                harness: parent.harness,
                model: parent.model,
                effort: parent.effort,
                autonomyMode: "autonomous",
                ownerQuestionAccess: "disabled",
              }),
            },
          },
        }),
      ],
    });

    const result = await executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runCommand: runDirectTestCommand,
      runContext,
      bus,
      store,
      log,
    }).promise;

    expect(decisionCalls).toBe(1);
    expect(result.continuation).toMatchObject({
      decision: { decision: "needs-owner" },
      packet: {
        queue: { revision: "unchanged-revision" },
        boundaries: ["material-scope-expansion"],
      },
    });
  }, 10_000);

  it("checkpoints repeated active rewrites in one file without waiting for repair checks", async () => {
    const { workspaceRoot, runContext, bus, store, log } = fixture;
    const harness = "workflow-continuation-active-same-scope-churn";
    registerAgentHarness({
      name: harness,
      description: "streaming same-scope continuation test harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: true,
      toolControl: "kota",
      run: async (options) => {
        for (let revision = 1; revision <= 3; revision += 1) {
          writeFileSync(
            join(runContext.sandbox.workspaceDir, "same-scope.ts"),
            `export const revision = ${revision};\n`,
          );
          await options.onMessage?.({
            type: "text",
            text: `Completed implementation revision ${revision}`,
          });
        }
        throw new Error("active churn did not request a checkpoint");
      },
    });
    execFileSync("git", ["init", "-q", "-b", "main"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.email", "t@example.com"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.name", "test"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    writeFileSync(join(runContext.sandbox.workspaceDir, "seed.txt"), "seed\n");
    execFileSync("git", ["add", "-A"], { cwd: runContext.sandbox.workspaceDir });
    execFileSync("git", ["commit", "-q", "-m", "seed"], {
      cwd: runContext.sandbox.workspaceDir,
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          repairLoop: {
            checks: [{ id: "complete", type: "code", run: () => "ok" }],
            continuation: {
              collectContext: () => ({
                taskContract: "# Admitted P1 task",
                current: { id: "task-current", priority: 1, priorityLabel: "p1" },
                queue: { revision: "unchanged-revision", available: [] },
              }),
              decide: () => ({
                decision: "preserve-yield",
                rationale: "Repeated active rewrites lack fresh acceptance evidence.",
                nextAction: "Resume the same session with the captured trajectory.",
              }),
              resolveAgentContract: (parent) => ({
                harness: parent.harness,
                model: parent.model,
                effort: parent.effort,
                autonomyMode: "autonomous",
                ownerQuestionAccess: "disabled",
              }),
            },
          },
        }),
      ],
    });

    const result = await executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runCommand: runDirectTestCommand,
      runContext,
      bus,
      store,
      log,
    }).promise;

    expect(result.continuation).toMatchObject({
      decision: { decision: "preserve-yield" },
      packet: {
        boundaries: ["active-workspace-churn", "unresolved-acceptance"],
        verificationTrajectory: [
          { source: "active", workspaceFingerprint: expect.any(String) },
          { source: "active", workspaceFingerprint: expect.any(String) },
          { source: "active", workspaceFingerprint: expect.any(String) },
        ],
      },
    });
  }, 10_000);

  it("persists an active continue decision before the resumed harness call settles", async () => {
    const { workspaceRoot, runContext, bus, store, log } = fixture;
    const harness = "workflow-continuation-active-continue-persistence";
    let harnessCalls = 0;
    let durableDecision: unknown;
    registerAgentHarness({
      name: harness,
      description: "streaming continuation persistence test harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: true,
      toolControl: "kota",
      run: async (options) => {
        harnessCalls += 1;
        if (harnessCalls === 1) {
          for (let index = 0; index < 4; index += 1) {
            writeFileSync(
              join(runContext.sandbox.workspaceDir, `active-${index}.ts`),
              `export const active${index} = true;\n`,
            );
          }
          await options.onMessage?.({
            type: "text",
            text: "Expanded the implementation scope",
          });
          throw new Error("continuation checkpoint did not interrupt the harness");
        }
        const activeMetadata = JSON.parse(
          readFileSync(
            join(workspaceRoot, ".kota", "runs", "test-run", "metadata.json"),
            "utf-8",
          ),
        ) as { continuations?: Array<{ decision?: unknown }> };
        durableDecision = activeMetadata.continuations?.at(-1)?.decision;
        return AGENT_OK_RESULT;
      },
    });
    execFileSync("git", ["init", "-q", "-b", "main"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.email", "t@example.com"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    execFileSync("git", ["config", "user.name", "test"], {
      cwd: runContext.sandbox.workspaceDir,
    });
    writeFileSync(join(runContext.sandbox.workspaceDir, "seed.txt"), "seed\n");
    execFileSync("git", ["add", "-A"], { cwd: runContext.sandbox.workspaceDir });
    execFileSync("git", ["commit", "-q", "-m", "seed"], {
      cwd: runContext.sandbox.workspaceDir,
    });

    const definition = makeDefinition({
      moduleRoot: workspaceRoot,
      steps: [
        makeAgentStep(workspaceRoot, harness, {
          repairLoop: {
            checks: [{ id: "complete", type: "code", run: () => "ok" }],
            continuation: {
              collectContext: () => ({
                taskContract: "# Admitted P1 task",
                current: { id: "task-current", priority: 1, priorityLabel: "p1" },
                queue: { revision: "unchanged-revision", available: [] },
              }),
              decide: () => ({
                decision: "continue",
                rationale: "The expanded implementation remains coherent and close to completion.",
                nextAction: "Finish the resumed active call.",
              }),
              resolveAgentContract: (parent) => ({
                harness: parent.harness,
                model: parent.model,
                effort: parent.effort,
                autonomyMode: "autonomous",
                ownerQuestionAccess: "disabled",
              }),
            },
          },
        }),
      ],
    });

    const result = await executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runCommand: runDirectTestCommand,
      runContext,
      bus,
      store,
      log,
    }).promise;

    expect(result.metadata.status).toBe("success");
    expect(harnessCalls).toBe(2);
    expect(durableDecision).toMatchObject({ decision: "continue" });
  }, 10_000);

});
