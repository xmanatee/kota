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

describe("nested step timeout propagation", () => {
  it("applies idleTimeoutMs to code children in parallel groups", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "fanout",
          type: "parallel",
          steps: [
            {
              id: "inner-code",
              type: "code",
              idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
              timeoutMs: AGENT_STEP_TIMEOUT_MS,
              run: () => new Promise(() => {}),
            },
          ],
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    const child = result.metadata.steps.find((step) => step.id === "inner-code");
    expect(result.metadata.status).toBe("failed");
    expect(child).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
  }, 10_000);

  it("applies idleTimeoutMs to code children in foreach groups", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "loop",
          type: "foreach",
          items: [1],
          as: "item",
          steps: [
            {
              id: "inner-code",
              type: "code",
              idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
              timeoutMs: AGENT_STEP_TIMEOUT_MS,
              run: () => new Promise(() => {}),
            },
          ],
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    const child = result.metadata.steps.find((step) => step.id === "inner-code");
    expect(result.metadata.status).toBe("failed");
    expect(child).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
  }, 10_000);

  it("preserves agent idle-timeout details and backoff from parallel groups", async () => {
    const harness = "workflow-parallel-idle-failure";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      await delayWithAbort(AGENT_IDLE_DELAY_MS, options.abortController?.signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        {
          id: "fanout",
          type: "parallel",
          steps: [
            makeAgentStep(fixture.workspaceRoot, harness, {
              id: "inner-agent",
              idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
              timeoutMs: AGENT_STEP_TIMEOUT_MS,
              retry: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 1 },
            }),
          ],
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    const child = result.metadata.steps.find((step) => step.id === "inner-agent");
    expect(result.metadata.status).toBe("failed");
    expect(result.agentBackoff).toMatchObject({ kind: "provider" });
    expect(child).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
  }, 10_000);

  it("preserves agent idle-timeout details and backoff from foreach groups", async () => {
    const harness = "workflow-foreach-idle-failure";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      await delayWithAbort(AGENT_IDLE_DELAY_MS, options.abortController?.signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        {
          id: "loop",
          type: "foreach",
          items: [1],
          as: "item",
          steps: [
            makeAgentStep(fixture.workspaceRoot, harness, {
              id: "inner-agent",
              idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
              timeoutMs: AGENT_STEP_TIMEOUT_MS,
              retry: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 1 },
            }),
          ],
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    const child = result.metadata.steps.find((step) => step.id === "inner-agent");
    expect(result.metadata.status).toBe("failed");
    expect(result.agentBackoff).toMatchObject({ kind: "provider" });
    expect(child).toMatchObject({
      status: "failed",
      errorKind: "idle-timeout",
      idleTimeoutMs: AGENT_IDLE_TIMEOUT_MS,
    });
  }, 10_000);

  it("lets hard timeoutMs win before an idle timeout deadline", async () => {
    const harness = "workflow-hard-timeout-wins";
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      await delayWithAbort(AGENT_IDLE_DELAY_MS, options.abortController?.signal);
      return AGENT_OK_RESULT;
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          idleTimeoutMs: 100,
          timeoutMs: 20,
          retry: { maxAttempts: 1, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps[0]?.error).toContain("timed out after 20ms");
    expect(result.metadata.steps[0]?.errorKind).toBe("step-timeout");
  }, 10_000);
});
