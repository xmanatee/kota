import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import {
  AGENT_IDLE_DELAY_MS,
  AGENT_IDLE_TIMEOUT_MS,
  AGENT_OK_RESULT,
  AGENT_STEP_TIMEOUT_MS,
  createRunExecutorTestFixture,
  delayWithAbort,
  makeAgentStep,
  makeDefinition,
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

describe("agent timeout telemetry", () => {
  it("retries agent idle timeouts through the agent retry classifier", async () => {
    const harness = "workflow-idle-retry";
    let attempts = 0;
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      attempts += 1;
      const signal = options.abortController?.signal;
      if (attempts === 1) {
        await delayWithAbort(AGENT_IDLE_DELAY_MS, signal);
      }
      await options.onMessage?.({ type: "text", text: "recovered" });
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
          timeoutMs: AGENT_STEP_TIMEOUT_MS,
          retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("success");
    expect(attempts).toBe(2);
  }, 10_000);

  it("records structured idle-timeout failure details before terminal publication", async () => {
    const alerts: unknown[] = [];
    fixture.bus.on("workflow.failure.alert", (payload) => alerts.push(payload));

    const harness = "workflow-idle-failure";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      await delayWithAbort(AGENT_IDLE_DELAY_MS, options.abortController?.signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
          timeoutMs: null,
          retry: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps[0]).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
    expect(alerts).toEqual([]);
  }, 10_000);

  it("records structured idle-timeout failure details from repair agents", async () => {
    const harness = "workflow-repair-idle-failure";
    let attempts = 0;
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      attempts += 1;
      if (attempts === 1) return AGENT_OK_RESULT;
      await delayWithAbort(AGENT_IDLE_DELAY_MS, options.abortController?.signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
          timeoutMs: AGENT_STEP_TIMEOUT_MS,
          retry: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 1 },
          repairLoop: {
            maxRepairAttempts: 1,
            checks: [
              {
                id: "post-check",
                type: "code",
                run: () => {
                  throw new Error("still failing");
                },
              },
            ],
          },
        }),
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.agentBackoff).toMatchObject({ kind: "provider" });
    expect(result.metadata.steps[0]).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
    expect(attempts).toBe(2);
  }, 10_000);

  it("records structured repair-loop exhaustion", async () => {
    const harness = "workflow-repair-exhausted";
    registerWorkflowScenarioDriver(harness, async () => AGENT_OK_RESULT);

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          repairLoop: {
            maxRepairAttempts: 1,
            checks: [
              {
                id: "post-check",
                type: "code",
                run: () => {
                  throw new Error("still failing");
                },
              },
            ],
          },
        }),
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps[0]).toMatchObject({
      status: "failed",
      errorKind: "repair-attempts-exhausted",
    });
  }, 10_000);
});
