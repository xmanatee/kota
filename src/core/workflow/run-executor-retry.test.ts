import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRunExecutorTestFixture,
  makeDefinition,
  type RunExecutorTestFixture,
  TRIGGER,
} from "./run-executor-test-fixture.js";
import { findRetryFromIndex } from "./run-executor-utils.js";
import type { WorkflowStepResult } from "./run-types.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";

describe("findRetryFromIndex", () => {
  it("returns 0 when original steps is empty", () => {
    const definition = [{ id: "step-a" }, { id: "step-b" }];
    expect(findRetryFromIndex([], definition)).toBe(0);
  });

  it("returns 0 when the first step failed without continueOnFailure", () => {
    const original: WorkflowStepResult[] = [
      { id: "step-a", type: "code", status: "failed", startedAt: "", completedAt: "", durationMs: 0 },
    ];
    expect(findRetryFromIndex(original, [{ id: "step-a" }, { id: "step-b" }])).toBe(0);
  });

  it("returns 1 when first step succeeded and second failed without continueOnFailure", () => {
    const original: WorkflowStepResult[] = [
      { id: "step-a", type: "code", status: "success", startedAt: "", completedAt: "", durationMs: 0 },
      { id: "step-b", type: "code", status: "failed", startedAt: "", completedAt: "", durationMs: 0 },
    ];
    expect(findRetryFromIndex(original, [{ id: "step-a" }, { id: "step-b" }, { id: "step-c" }])).toBe(1);
  });

  it("skips continueOnFailure failed steps when finding retry point", () => {
    const original: WorkflowStepResult[] = [
      { id: "step-a", type: "code", status: "success", startedAt: "", completedAt: "", durationMs: 0 },
      { id: "step-b", type: "code", status: "failed", continueOnFailure: true, startedAt: "", completedAt: "", durationMs: 0 },
      { id: "step-c", type: "code", status: "failed", startedAt: "", completedAt: "", durationMs: 0 },
    ];
    expect(findRetryFromIndex(original, [{ id: "step-a" }, { id: "step-b" }, { id: "step-c" }])).toBe(2);
  });

  it("returns definitionSteps.length when all steps completed", () => {
    const original: WorkflowStepResult[] = [
      { id: "step-a", type: "code", status: "success", startedAt: "", completedAt: "", durationMs: 0 },
      { id: "step-b", type: "code", status: "success", startedAt: "", completedAt: "", durationMs: 0 },
    ];
    expect(findRetryFromIndex(original, [{ id: "step-a" }, { id: "step-b" }])).toBe(2);
  });

});

describe("retry execution", () => {
  let fixture: RunExecutorTestFixture;
  beforeEach(() => {
    fixture = createRunExecutorTestFixture();
  });
  afterEach(() => {
    fixture.dispose();
  });

  function runDefinition(definition: WorkflowDefinition, trigger = TRIGGER) {
    return fixture.execute(definition, { trigger }).promise;
  }

  it("retries from the first failed step, replaying prior successful steps", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        {
          id: "step-a",
          type: "code",
          run: () => { executed.push("step-a"); return { fromA: true }; },
        },
        {
          id: "step-b",
          type: "code",
          run: () => { executed.push("step-b"); throw new Error("transient"); },
        },
        {
          id: "step-c",
          type: "code",
          run: (ctx) => {
            executed.push("step-c");
            return { fromA: ctx.stepOutputs["step-a"], previous: ctx.previousOutput };
          },
        },
      ],
    });

    // Original run: step-a succeeds, step-b fails
    const original = await runDefinition(definition);
    expect(original.metadata.status).toBe("failed");
    const originalId = original.metadata.id;
    executed.length = 0;

    // Fix step-b for the retry
    const retryDefinition = makeDefinition({
      steps: [
        {
          id: "step-a",
          type: "code",
          run: () => { executed.push("step-a"); return { fromA: true }; },
        },
        {
          id: "step-b",
          type: "code",
          run: () => { executed.push("step-b"); return { fromB: true }; },
        },
        {
          id: "step-c",
          type: "code",
          run: (ctx) => {
            executed.push("step-c");
            return { fromA: ctx.stepOutputs["step-a"], previous: ctx.previousOutput };
          },
        },
      ],
    });

    const retryTrigger: WorkflowRunTrigger = {
      event: "runtime.idle",
      schemaRef: null, payload: { retryOf: originalId, triggeredAt: new Date().toISOString() },
    };

    const retried = await runDefinition(retryDefinition, retryTrigger);

    // Only step-b and step-c should have been re-executed
    expect(executed).toEqual(["step-b", "step-c"]);
    expect(retried.metadata.status).toBe("success");
    expect(retried.metadata.retryOf).toBe(originalId);
    expect(retried.metadata.steps[2]?.output).toEqual({
      fromA: { fromA: true }, previous: { fromB: true },
    });
    expect(fixture.store.getRun(retried.metadata.id)?.retryOf).toBe(originalId);

    // All three steps should be recorded in the retry run
    expect(retried.metadata.steps).toHaveLength(3);
    expect(retried.metadata.steps[0].id).toBe("step-a");
    expect(retried.metadata.steps[0].status).toBe("success");
    expect(retried.metadata.steps[0].reused).toBe(true);
    expect(retried.metadata.steps[1].id).toBe("step-b");
    expect(retried.metadata.steps[1].status).toBe("success");
    expect(retried.metadata.steps[2].id).toBe("step-c");
    expect(retried.metadata.steps[2].status).toBe("success");
  });

  it("reexecutes current-run ownership without replaying prior pure work", async () => {
    const executed: string[] = [];
    let failAfterClaim = true;
    const [definition] = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("test/retry-run-ownership.ts", {
          repository: "read",
          name: "retry-run-ownership",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "inspect",
              type: "code",
              run: () => {
                executed.push("inspect");
                return { taskId: "task-one" };
              },
            },
            {
              id: "claim",
              type: "code",
              rerunOnRetry: true,
              run: (ctx) => {
                executed.push(`claim:${ctx.workflow.runId}`);
                return { ownerRunId: ctx.workflow.runId };
              },
            },
            {
              id: "prepare",
              type: "code",
              run: (ctx) => {
                executed.push(`prepare:${ctx.workflow.runId}`);
                const claim = ctx.stepOutputs.claim as
                  | { ownerRunId?: string }
                  | undefined;
                if (claim?.ownerRunId !== ctx.workflow.runId) {
                  throw new Error(
                    `claim belongs to ${String(claim?.ownerRunId)}`,
                  );
                }
                if (failAfterClaim) throw new Error("transient prepare failure");
                return { prepared: true };
              },
            },
          ],
        }),
      ],
      fixture.workspaceRoot,
    );
    if (!definition) throw new Error("validated workflow definition is missing");

    const original = await runDefinition(definition);
    expect(original.metadata.status).toBe("failed");
    executed.length = 0;
    failAfterClaim = false;

    const retried = await runDefinition(definition, {
      event: "runtime.idle",
      schemaRef: null,
      payload: { retryOf: original.metadata.id },
    });

    expect(retried.metadata.status).toBe("success");
    expect(executed).toEqual([
      `claim:${retried.metadata.id}`,
      `prepare:${retried.metadata.id}`,
    ]);
    expect(retried.metadata.steps[0]).toMatchObject({
      id: "inspect",
      reused: true,
    });
    expect(retried.metadata.steps[1]).toMatchObject({
      id: "claim",
      output: { ownerRunId: retried.metadata.id },
    });
    expect(retried.metadata.steps[1]?.reused).not.toBe(true);
  });

  it("retries from the first step when the first step failed", async () => {
    const executed: string[] = [];
    let firstStepShouldFail = true;

    const definition = makeDefinition({
      steps: [
        {
          id: "step-a",
          type: "code",
          run: () => {
            executed.push("step-a");
            if (firstStepShouldFail) throw new Error("first failure");
            return { ok: true };
          },
        },
        {
          id: "step-b",
          type: "code",
          run: () => { executed.push("step-b"); return { done: true }; },
        },
      ],
    });

    // Original run: step-a fails immediately
    const original = await runDefinition(definition);
    expect(original.metadata.status).toBe("failed");
    expect(original.metadata.steps).toHaveLength(1);
    const originalId = original.metadata.id;
    executed.length = 0;

    // Retry: step-a now succeeds
    firstStepShouldFail = false;
    const retryTrigger: WorkflowRunTrigger = {
      event: "runtime.idle",
      schemaRef: null, payload: { retryOf: originalId, triggeredAt: new Date().toISOString() },
    };

    const retried = await runDefinition(definition, retryTrigger);

    expect(executed).toEqual(["step-a", "step-b"]);
    expect(retried.metadata.status).toBe("success");
    expect(retried.metadata.retryOf).toBe(originalId);
    expect(retried.metadata.steps).toHaveLength(2);
  });

});
