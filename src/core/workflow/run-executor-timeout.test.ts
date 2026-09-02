import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_STEP_TIMEOUT_MS } from "./run-executor-step.js";
import {
  createRunExecutorTestFixture,
  delayWithAbort,
  makeDefinition,
  type RunExecutorTestFixture,
} from "./run-executor-test-fixture.js";
import type { WorkflowDefinition } from "./types.js";

let fixture: RunExecutorTestFixture;

beforeEach(() => {
  fixture = createRunExecutorTestFixture();
});

afterEach(() => {
  fixture.dispose();
});

describe("step timeout", () => {
  it("DEFAULT_STEP_TIMEOUT_MS is a hang rail, not a task-size limit", () => {
    expect(DEFAULT_STEP_TIMEOUT_MS).toBe(3 * 60 * 60 * 1000);
  });

  it("fails the run when a step exceeds its timeoutMs", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "hanging-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}),
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.steps[0]?.errorKind).toBe("step-timeout");
    const errorLog = (fixture.log.mock.calls as string[][])
      .flat()
      .find((message) => message.includes("Failed"));
    expect(errorLog).toContain("hanging-step");
    expect(errorLog).toContain("timed out");
  }, 10_000);

  it("run status is 'failed' (not 'interrupted') on step timeout", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "slow-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}),
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("failed");
  }, 10_000);

  it("subsequent steps do not run after a timeout failure", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        {
          id: "slow-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}),
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

    await fixture.execute(definition).promise;

    expect(executed).toEqual([]);
  }, 10_000);

  it("defers workflow failure publication on step timeout to the terminal rail", async () => {
    const alerts: unknown[] = [];
    fixture.bus.on("workflow.failure.alert", (payload) => alerts.push(payload));
    const definition = makeDefinition({
      steps: [
        {
          id: "stuck-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}),
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("failed");
    expect(alerts).toEqual([]);
  }, 10_000);

  it("lets code steps exceed idleTimeoutMs when they report typed progress", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "heartbeat-step",
          type: "code",
          idleTimeoutMs: 25,
          run: async (ctx) => {
            await delayWithAbort(15);
            ctx.reportProgress({ kind: "code-heartbeat", label: "first" });
            await delayWithAbort(15);
            ctx.reportProgress({ kind: "code-heartbeat", label: "second" });
            await delayWithAbort(15);
            return { ok: true };
          },
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[0]?.output).toEqual({ ok: true });
  }, 10_000);

  it("keeps await-event steps governed by awaitTimeoutMs, not idleTimeoutMs", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "wait",
          type: "await-event",
          event: "owner.answer",
          matchField: "id",
          matchValue: "question-1",
          awaitTimeoutMs: 25,
          idleTimeoutMs: 5,
        } as WorkflowDefinition["steps"][number],
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps[0]?.output).toMatchObject({
      kind: "timeout",
      awaitTimeoutMs: 25,
    });
    expect(result.metadata.steps[0]?.errorKind).toBeUndefined();
  }, 10_000);

});

describe("foreach step timeout", () => {
  it("fails the run when a foreach step exceeds its timeoutMs", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "hanging-foreach",
          type: "foreach",
          timeoutMs: 50,
          items: [1, 2, 3],
          as: "item",
          steps: [
            {
              id: "inner",
              type: "code",
              run: () => new Promise(() => {}),
            },
          ],
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("failed");
    const errorLog = (fixture.log.mock.calls as string[][])
      .flat()
      .find((message) => message.includes("Failed"));
    expect(errorLog).toContain("hanging-foreach");
    expect(errorLog).toContain("timed out");
  }, 10_000);

  it("run status is 'failed' (not 'interrupted') on foreach step timeout", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "slow-foreach",
          type: "foreach",
          timeoutMs: 50,
          items: [1],
          as: "item",
          steps: [
            {
              id: "inner",
              type: "code",
              run: () => new Promise(() => {}),
            },
          ],
        },
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("failed");
  }, 10_000);
});
