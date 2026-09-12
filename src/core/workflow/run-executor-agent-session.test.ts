import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import {
  AGENT_OK_RESULT,
  createRunExecutorTestFixture,
  delayWithAbort,
  makeAgentStep,
  makeDefinition,
  makeRunContext,
  type RunExecutorTestFixture,
  registerWorkflowScenarioDriver,
} from "./run-executor-test-fixture.js";

let fixture: RunExecutorTestFixture;

beforeEach(() => {
  fixture = createRunExecutorTestFixture();
});

afterEach(() => {
  fixture.dispose();
});

describe("agent session supervision", () => {
  it("lets streaming agent steps exceed idleTimeoutMs while typed messages arrive", async () => {
    const harness = "workflow-idle-productive";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      const signal = options.abortController?.signal;
      await delayWithAbort(100, signal);
      await options.onMessage?.({ type: "text", text: "one" });
      await delayWithAbort(100, signal);
      await options.onMessage?.({
        type: "tool_call",
        toolUseId: "t1",
        toolName: "read",
        input: {},
      });
      await delayWithAbort(100, signal);
      await options.onMessage?.({
        type: "tool_result",
        toolUseId: "t1",
        isError: false,
        content: "ok",
      });
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          idleTimeoutMs: 250,
          timeoutMs: 2000,
        }),
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[0]?.harness).toBe(harness);
  }, 10_000);

  it("resumes a provider session when the same durable run is attempted again", async () => {
    const harness = "workflow-durable-session";
    const resumeSessionIds: Array<string | undefined> = [];
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      resumeSessionIds.push(options.resumeSessionId);
      if (resumeSessionIds.length === 1) {
        return {
          ...AGENT_OK_RESULT,
          text: "Individual quota reached. Resets in 1m.",
          streamedText: "",
          sessionId: "provider-session-1",
          subtype: "ERROR",
          isError: true,
        };
      }
      return { ...AGENT_OK_RESULT, sessionId: "provider-session-1" };
    });
    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [makeAgentStep(fixture.workspaceRoot, harness)],
    });

    const first = await fixture.execute(definition, {
      runContext: makeRunContext(fixture.workspaceRoot, 1),
    }).promise;
    expect(first.metadata.steps[0]).toMatchObject({
      status: "failed",
      output: { sessionId: "provider-session-1" },
    });

    const second = await fixture.execute(definition, {
      runContext: makeRunContext(fixture.workspaceRoot, 2),
    }).promise;

    expect(second.metadata.status).toBe("success");
    expect(resumeSessionIds).toEqual([undefined, "provider-session-1"]);
  });

  it("continues the initial preserved agent session during post-check repair", async () => {
    const harness = "workflow-repair-session";
    const resumes: Array<string | undefined> = [];
    registerWorkflowScenarioDriver(harness, async (options) => {
      resumes.push(options.resumeSessionId);
      return { ...AGENT_OK_RESULT, sessionId: "repair-session" };
    });
    let checks = 0;
    const result = await fixture.execute(makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [makeAgentStep(fixture.workspaceRoot, harness, {
        repairLoop: {
          maxRepairAttempts: 1,
          checks: [{ id: "acceptance", type: "code", run: () => {
            if (checks++ === 0) throw new Error("needs repair");
            return "ok";
          } }],
        },
      })],
    })).promise;
    expect(result.metadata.status).toBe("success");
    expect(resumes).toEqual([undefined, "repair-session"]);
    expect(checks).toBe(2);
  });

  it("governs an unbounded agent step only by trusted idle progress", async () => {
    const harness = "workflow-idle-governed";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      const signal = options.abortController?.signal;
      await delayWithAbort(30, signal);
      await options.onMessage?.({ type: "text", text: "one" });
      await delayWithAbort(30, signal);
      await options.onMessage?.({ type: "text", text: "two" });
      await delayWithAbort(30, signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          timeoutMs: null,
          idleTimeoutMs: 50,
        }),
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[0]?.activeDurationMs).toBeUndefined();
  }, 10_000);
});
