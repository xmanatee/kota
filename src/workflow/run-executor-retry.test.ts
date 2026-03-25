import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus.js";
import { executeWorkflowRun, findRetryFromIndex } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition, WorkflowRunMetadata, WorkflowRunTrigger, WorkflowStepResult } from "./types.js";

function makeDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    definitionPath: "src/workflows/test/workflow.ts",
    triggers: [],
    steps: [],
    ...overrides,
  };
}

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", payload: {} };

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
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  async function runDefinition(definition: WorkflowDefinition, trigger = TRIGGER) {
    const { promise } = executeWorkflowRun(definition, trigger, { projectDir, bus, store, log });
    return promise;
  }

  function readRunMetadata(runId: string): WorkflowRunMetadata {
    return JSON.parse(
      readFileSync(join(projectDir, ".kota", "runs", runId, "metadata.json"), "utf-8"),
    ) as WorkflowRunMetadata;
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
          run: (ctx) => { executed.push("step-c"); return { prevOutput: ctx.previousOutput }; },
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
          run: (ctx) => { executed.push("step-c"); return { prevOutput: ctx.previousOutput }; },
        },
      ],
    });

    const retryTrigger: WorkflowRunTrigger = {
      event: "retry",
      payload: { retryOf: originalId, triggeredAt: new Date().toISOString() },
    };

    const retried = await runDefinition(retryDefinition, retryTrigger);

    // Only step-b and step-c should have been re-executed
    expect(executed).toEqual(["step-b", "step-c"]);
    expect(retried.metadata.status).toBe("success");
    expect(retried.metadata.retryOf).toBe(originalId);

    // All three steps should be recorded in the retry run
    expect(retried.metadata.steps).toHaveLength(3);
    expect(retried.metadata.steps[0].id).toBe("step-a");
    expect(retried.metadata.steps[0].status).toBe("success");
    expect(retried.metadata.steps[1].id).toBe("step-b");
    expect(retried.metadata.steps[1].status).toBe("success");
    expect(retried.metadata.steps[2].id).toBe("step-c");
    expect(retried.metadata.steps[2].status).toBe("success");
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
      event: "retry",
      payload: { retryOf: originalId, triggeredAt: new Date().toISOString() },
    };

    const retried = await runDefinition(definition, retryTrigger);

    expect(executed).toEqual(["step-a", "step-b"]);
    expect(retried.metadata.status).toBe("success");
    expect(retried.metadata.retryOf).toBe(originalId);
    expect(retried.metadata.steps).toHaveLength(2);
  });

  it("replayed steps carry original outputs into step context", async () => {
    let capturedPreviousOutput: unknown;
    let capturedStepOutputs: Record<string, unknown> = {};

    const definition = makeDefinition({
      steps: [
        {
          id: "step-a",
          type: "code",
          run: () => ({ fromA: "original-value" }),
        },
        {
          id: "step-b",
          type: "code",
          run: () => { throw new Error("fail"); },
        },
        {
          id: "step-c",
          type: "code",
          run: (ctx) => {
            capturedPreviousOutput = ctx.previousOutput;
            capturedStepOutputs = ctx.stepOutputs as Record<string, unknown>;
            return "done";
          },
        },
      ],
    });

    // Original: step-a succeeds, step-b fails
    const original = await runDefinition(definition);
    const originalId = original.metadata.id;

    // Retry with step-b fixed
    const retryDefinition = makeDefinition({
      steps: [
        {
          id: "step-a",
          type: "code",
          run: () => ({ fromA: "original-value" }),
        },
        {
          id: "step-b",
          type: "code",
          run: () => ({ fromB: true }),
        },
        {
          id: "step-c",
          type: "code",
          run: (ctx) => {
            capturedPreviousOutput = ctx.previousOutput;
            capturedStepOutputs = ctx.stepOutputs as Record<string, unknown>;
            return "done";
          },
        },
      ],
    });

    const retryTrigger: WorkflowRunTrigger = {
      event: "retry",
      payload: { retryOf: originalId },
    };
    await runDefinition(retryDefinition, retryTrigger);

    // step-c should see step-a's output from the original run via stepOutputs
    expect((capturedStepOutputs["step-a"] as { fromA: string }).fromA).toBe("original-value");
    // previousOutput at step-c should be step-b's output (from the retry re-execution)
    expect((capturedPreviousOutput as { fromB: boolean }).fromB).toBe(true);
  });

  it("links retry run to original via retryOf metadata", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "step-a",
          type: "code",
          run: () => { throw new Error("fail"); },
        },
      ],
    });

    const original = await runDefinition(definition);
    expect(original.metadata.status).toBe("failed");
    const originalId = original.metadata.id;

    const retryDefinition = makeDefinition({
      steps: [
        { id: "step-a", type: "code", run: () => "ok" },
      ],
    });

    const retryTrigger: WorkflowRunTrigger = {
      event: "retry",
      payload: { retryOf: originalId },
    };
    const retried = await runDefinition(retryDefinition, retryTrigger);

    expect(retried.metadata.retryOf).toBe(originalId);

    // Verify persisted metadata has retryOf
    const dirs = readdirSync(join(projectDir, ".kota", "runs")).sort().reverse();
    const retryRunId = dirs[0]; // most recent
    const persisted = readRunMetadata(retryRunId);
    expect(persisted.retryOf).toBe(originalId);
  });
});
