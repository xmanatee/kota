import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessRunOptions,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { DeadLetterQueueStore } from "#core/daemon/dead-letter-queue.js";
import { EventBus } from "#core/events/event-bus.js";
import { createTestWorkflowRuntime } from "./testing/runtime-fixture.js";
import { registerWorkflowDefinition } from "./validation.js";

describe("resolved agent contract pre-dispatch validation", () => {
  let projectDir: string;
  const runStates: Array<{ close(): void }> = [];
  const run = vi.fn(async (_options: AgentHarnessRunOptions) => ({
    text: "unused",
    streamedText: "",
    turns: 1,
    isError: false,
  }));
  const harness: AgentHarness = {
    name: "pre-dispatch-passive-fixture",
    description: "pre-dispatch fixture",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "native",
    nativeAbortQuarantine: "confirmed-stop",
    unsupportedRunOptions: [{
      runOption: "autonomyMode.passive",
      option: 'autonomyMode="passive"',
      reason: "Passive execution is statically impossible.",
    }],
    run,
  };
  const agent: AgentDef = {
    name: "reviewer",
    role: "Review input.",
    promptPath: "agents/reviewer.md",
    model: "fixture-model",
    effort: "high",
    writeScope: "deny-all",
  };

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-agent-contract-dispatch-"));
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    for (const runState of runStates.splice(0)) runState.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates no queue, run, launch, or DLQ record for an invalid definition", () => {
    mkdirSync(join(projectDir, "agents"), { recursive: true });
    writeFileSync(join(projectDir, agent.promptPath), "Review the input.\n");
    registerAgentHarness(harness);
    const deadLetterQueue = new DeadLetterQueueStore(
      join(projectDir, ".kota", "dead-letter-queue"),
    );
    const definition = registerWorkflowDefinition(
      "src/core/workflow/agent-run-contract-dispatch.test.ts",
      {
      repository: "read",
      name: "pre-dispatch-contract-fixture",
      moduleRoot: projectDir,
      triggers: [{ event: "manual" }],
      steps: [{
        id: "review",
        type: "agent",
        agentName: agent.name,
        harness: harness.name,
        autonomyMode: "passive",
      }],
      },
    );
    const { runtime, runState } = createTestWorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      workflows: [definition],
      config: { defaultAgentHarness: harness.name },
      deadLetterQueue,
      resolveAgentDef: (name) => (name === agent.name ? agent : undefined),
    });
    runStates.push(runState);

    expect(() => runtime.start()).toThrow(/Passive execution is statically impossible/);
    expect(runtime.getState().pendingRuns).toEqual([]);
    expect(readdirSync(join(projectDir, ".kota", "runs"))).toEqual([]);
    expect(deadLetterQueue.list()).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an unregistered repair-loop judge before creating dispatch records", () => {
    mkdirSync(join(projectDir, "agents"), { recursive: true });
    writeFileSync(join(projectDir, agent.promptPath), "Review the input.\n");
    registerAgentHarness({ ...harness, unsupportedRunOptions: [] });
    const deadLetterQueue = new DeadLetterQueueStore(
      join(projectDir, ".kota", "dead-letter-queue"),
    );
    const definition = registerWorkflowDefinition(
      "src/core/workflow/agent-run-contract-dispatch.test.ts",
      {
        repository: "read",
        name: "unregistered-repair-judge-fixture",
        moduleRoot: projectDir,
        triggers: [{ event: "manual" }],
        steps: [{
          id: "review",
          type: "agent",
          agentName: agent.name,
          harness: harness.name,
          autonomyMode: "autonomous",
          repairLoop: {
            checks: [{
              id: "judge",
              type: "code",
              resolveAgentContract: () => ({
                harness: "missing-repair-judge-harness",
                model: "judge-model",
                effort: "high",
                autonomyMode: "autonomous",
                ownerQuestionAccess: "disabled",
              }),
              run: () => "unused",
            }],
          },
        }],
      },
    );
    const { runtime, runState } = createTestWorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      workflows: [definition],
      config: { defaultAgentHarness: harness.name },
      deadLetterQueue,
      resolveAgentDef: (name) => (name === agent.name ? agent : undefined),
    });
    runStates.push(runState);

    expect(() => runtime.start()).toThrow(
      /unregistered-repair-judge-fixture.*steps\[0\]\.repairLoop\.checks\[0\].*missing-repair-judge-harness/,
    );
    expect(runtime.getState().pendingRuns).toEqual([]);
    expect(readdirSync(join(projectDir, ".kota", "runs"))).toEqual([]);
    expect(deadLetterQueue.list()).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an unregistered code-step agent before creating dispatch records", () => {
    const deadLetterQueue = new DeadLetterQueueStore(
      join(projectDir, ".kota", "dead-letter-queue"),
    );
    const definition = registerWorkflowDefinition(
      "src/core/workflow/agent-run-contract-dispatch.test.ts",
      {
        repository: "read",
        name: "unregistered-code-step-agent-fixture",
        moduleRoot: projectDir,
        triggers: [{ event: "manual" }],
        steps: [{
          id: "shadow-review",
          type: "code",
          resolveAgentContract: () => ({
            harness: "missing-code-step-agent-harness",
            model: "review-model",
            effort: "high",
            autonomyMode: "autonomous",
            ownerQuestionAccess: "disabled",
          }),
          run: () => "unused",
        }],
      },
    );
    const { runtime, runState } = createTestWorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      workflows: [definition],
      config: { defaultAgentHarness: harness.name },
      deadLetterQueue,
    });
    runStates.push(runState);

    expect(() => runtime.start()).toThrow(
      /unregistered-code-step-agent-fixture.*steps\[0\].*missing-code-step-agent-harness/,
    );
    expect(runtime.getState().pendingRuns).toEqual([]);
    expect(readdirSync(join(projectDir, ".kota", "runs"))).toEqual([]);
    expect(deadLetterQueue.list()).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
