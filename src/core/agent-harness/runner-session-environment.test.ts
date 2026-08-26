import { describe, expect, it, vi } from "vitest";
import {
  injectSessionEnvironmentVariable,
  registerSessionEnvironment,
  sessionEnvironmentForExecution,
  unregisterSessionEnvironment,
} from "#core/tools/session-environment.js";
import { runAgentHarness } from "./runner.js";
import type { AgentHarnessSessionContext } from "./session-context.js";
import type { AgentHarness } from "./types.js";

const workflowContext = {
  workflowName: "security-review",
  runId: "run-1",
  stepId: "build",
  spanId: "run-1:build",
  scopeId: "scope-a",
};

function harnessWithRun(run: AgentHarness["run"]): AgentHarness {
  return {
    name: "session-environment-test",
    description: "session environment lifecycle test harness",
    supportsMultiTurn: true,
    supportedHookKinds: ["preRun", "postRun"],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    run,
  };
}

describe("runAgentHarness session environment", () => {
  it.each([
    { label: "success", throws: false },
    { label: "failure", throws: true },
  ])("erases the workflow overlay after harness $label", async ({ throws }) => {
    let identity: AgentHarnessSessionContext | undefined;
    const run = vi.fn(async (options) => {
      identity = options.sessionContext;
      if (identity === undefined) throw new Error("missing session context");
      injectSessionEnvironmentVariable(
        identity,
        "KOTA_HARNESS_SESSION_SECRET",
        "temporary-value",
      );
      if (throws) throw new Error("adapter failed");
      return {
        text: "done",
        streamedText: "done",
        turns: 1,
        isError: false,
      };
    });
    const execution = runAgentHarness(harnessWithRun(run), {
      prompt: "hello",
      effort: "xhigh",
      workflowContext,
    });

    if (throws) await expect(execution).rejects.toThrow("adapter failed");
    else await expect(execution).resolves.toMatchObject({ text: "done" });

    expect(identity?.sessionId).not.toBe(workflowContext.spanId);
    expect(sessionEnvironmentForExecution(identity)).toEqual({});
  });

  it("keeps an explicitly owned interactive overlay until its caller tears down", async () => {
    const identity = {
      sessionId: "interactive-session",
      scopeId: "scope-a",
    };
    registerSessionEnvironment(identity);
    const run = vi.fn(async (options) => {
      if (options.sessionContext !== identity) {
        throw new Error("interactive session identity was not preserved");
      }
      injectSessionEnvironmentVariable(
        identity,
        "KOTA_HARNESS_SESSION_SECRET",
        "persistent-value",
      );
      return {
        text: "done",
        streamedText: "done",
        turns: 1,
        isError: false,
      };
    });

    await runAgentHarness(harnessWithRun(run), {
      prompt: "hello",
      effort: "xhigh",
      sessionContext: identity,
    });

    expect(sessionEnvironmentForExecution(identity)).toEqual({
      KOTA_HARNESS_SESSION_SECRET: "persistent-value",
    });
    unregisterSessionEnvironment(identity);
    expect(sessionEnvironmentForExecution(identity)).toEqual({});
  });

  it("isolates concurrent executions that share one workflow step span", async () => {
    let started = 0;
    let releaseBoth: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    const identities: AgentHarnessSessionContext[] = [];
    const run = vi.fn(async (options) => {
      const identity = options.sessionContext;
      if (identity === undefined) throw new Error("missing session context");
      identities.push(identity);
      injectSessionEnvironmentVariable(
        identity,
        "KOTA_HARNESS_SESSION_SECRET",
        options.prompt,
      );
      started++;
      if (started === 2) releaseBoth?.();
      await bothStarted;
      expect(sessionEnvironmentForExecution(identity)).toEqual({
        KOTA_HARNESS_SESSION_SECRET: options.prompt,
      });
      return {
        text: "done",
        streamedText: "done",
        turns: 1,
        isError: false,
      };
    });
    const harness = harnessWithRun(run);

    await Promise.all([
      runAgentHarness(harness, {
        prompt: "iteration-a",
        effort: "xhigh",
        workflowContext,
      }),
      runAgentHarness(harness, {
        prompt: "iteration-b",
        effort: "xhigh",
        workflowContext,
      }),
    ]);

    expect(identities).toHaveLength(2);
    expect(identities[0]?.sessionId).not.toBe(identities[1]?.sessionId);
    expect(sessionEnvironmentForExecution(identities[0])).toEqual({});
    expect(sessionEnvironmentForExecution(identities[1])).toEqual({});
  });
});
