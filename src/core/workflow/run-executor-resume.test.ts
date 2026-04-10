import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../events/event-bus.js";
import { executeWorkflowRun } from "./run-executor.js";
import { findResumeFromIndex } from "./run-executor-utils.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunMetadata, WorkflowStepResult } from "./run-types.js";
import type { WorkflowDefinition, WorkflowRunTrigger } from "./types.js";

function makeDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    triggers: [],
    steps: [],
    ...overrides,
  };
}

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", payload: {} };

// ---------------------------------------------------------------------------
// findResumeFromIndex
// ---------------------------------------------------------------------------

describe("findResumeFromIndex", () => {
  const defSteps = [{ id: "step-a" }, { id: "step-b" }, { id: "step-c" }];

  function makeStep(id: string, status: WorkflowStepResult["status"] = "success"): WorkflowStepResult {
    return { id, type: "code", status, startedAt: "", completedAt: "", durationMs: 0 };
  }

  it("returns 0 when resuming from the first step with no prerequisites to check", () => {
    const original = [makeStep("step-a"), makeStep("step-b")];
    expect(findResumeFromIndex("step-a", defSteps, original)).toBe(0);
  });

  it("returns the correct index when preceding steps succeeded", () => {
    const original = [makeStep("step-a"), makeStep("step-b")];
    expect(findResumeFromIndex("step-b", defSteps, original)).toBe(1);
    expect(findResumeFromIndex("step-c", defSteps, original)).toBe(2);
  });

  it("throws when the step ID is not in the definition", () => {
    const original = [makeStep("step-a")];
    expect(() => findResumeFromIndex("nonexistent", defSteps, original)).toThrow(
      `Step "nonexistent" not found in workflow definition`,
    );
  });

  it("throws when a prerequisite step failed", () => {
    const original = [makeStep("step-a", "failed"), makeStep("step-b")];
    expect(() => findResumeFromIndex("step-b", defSteps, original)).toThrow(
      `prerequisite step "step-a" did not complete successfully`,
    );
  });

  it("throws when a prerequisite step is missing from original steps", () => {
    const original: WorkflowStepResult[] = [];
    expect(() => findResumeFromIndex("step-b", defSteps, original)).toThrow(
      `prerequisite step "step-a" did not complete successfully`,
    );
  });

  it("throws when a prerequisite step has skipped status", () => {
    const original = [makeStep("step-a", "skipped")];
    expect(() => findResumeFromIndex("step-b", defSteps, original)).toThrow(
      `prerequisite step "step-a" did not complete successfully`,
    );
  });
});

// ---------------------------------------------------------------------------
// resume execution
// ---------------------------------------------------------------------------

describe("resume execution", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

  it("resumes from a specific step, skipping prior steps", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        { id: "step-a", type: "code", run: () => { executed.push("step-a"); return { fromA: true }; } },
        { id: "step-b", type: "code", run: () => { executed.push("step-b"); throw new Error("transient"); } },
        { id: "step-c", type: "code", run: () => { executed.push("step-c"); return { fromC: true }; } },
      ],
    });

    // Original run: step-a succeeds, step-b fails
    const original = await runDefinition(definition);
    expect(original.metadata.status).toBe("failed");
    const originalId = original.metadata.id;
    executed.length = 0;

    // Fix step-b for the resume
    const resumeDefinition = makeDefinition({
      steps: [
        { id: "step-a", type: "code", run: () => { executed.push("step-a"); return { fromA: true }; } },
        { id: "step-b", type: "code", run: () => { executed.push("step-b"); return { fromB: true }; } },
        { id: "step-c", type: "code", run: () => { executed.push("step-c"); return { fromC: true }; } },
      ],
    });

    const resumeTrigger: WorkflowRunTrigger = {
      event: "resume",
      payload: { resumedFromRunId: originalId, resumeFromStep: "step-b" },
    };

    const resumed = await runDefinition(resumeDefinition, resumeTrigger);

    // Only step-b and step-c should have been re-executed
    expect(executed).toEqual(["step-b", "step-c"]);
    expect(resumed.metadata.status).toBe("success");
    expect(resumed.metadata.resumedFromRunId).toBe(originalId);

    // All three steps should be recorded
    expect(resumed.metadata.steps).toHaveLength(3);
    expect(resumed.metadata.steps[0]!.id).toBe("step-a");
    expect(resumed.metadata.steps[0]!.reused).toBe(true);
    expect(resumed.metadata.steps[0]!.durationMs).toBe(0);
    expect(resumed.metadata.steps[1]!.id).toBe("step-b");
    expect(resumed.metadata.steps[1]!.reused).toBeUndefined();
    expect(resumed.metadata.steps[2]!.id).toBe("step-c");
    expect(resumed.metadata.steps[2]!.reused).toBeUndefined();
  });

  it("reused step outputs are available via stepOutputs in later steps", async () => {
    let capturedStepOutputs: Record<string, unknown> = {};
    let capturedPreviousOutput: unknown;

    const definition = makeDefinition({
      steps: [
        { id: "step-a", type: "code", run: () => ({ fromA: "original-value" }) },
        { id: "step-b", type: "code", run: () => { throw new Error("fail"); } },
        {
          id: "step-c",
          type: "code",
          run: (ctx) => {
            capturedStepOutputs = ctx.stepOutputs as Record<string, unknown>;
            capturedPreviousOutput = ctx.previousOutput;
            return "done";
          },
        },
      ],
    });

    const original = await runDefinition(definition);
    const originalId = original.metadata.id;

    const resumeDefinition = makeDefinition({
      steps: [
        { id: "step-a", type: "code", run: () => ({ fromA: "original-value" }) },
        { id: "step-b", type: "code", run: () => ({ fromB: true }) },
        {
          id: "step-c",
          type: "code",
          run: (ctx) => {
            capturedStepOutputs = ctx.stepOutputs as Record<string, unknown>;
            capturedPreviousOutput = ctx.previousOutput;
            return "done";
          },
        },
      ],
    });

    await runDefinition(resumeDefinition, {
      event: "resume",
      payload: { resumedFromRunId: originalId, resumeFromStep: "step-b" },
    });

    // step-a's output from the original run should be in stepOutputs
    expect((capturedStepOutputs["step-a"] as { fromA: string }).fromA).toBe("original-value");
    // previousOutput at step-c should be step-b's newly executed output
    expect((capturedPreviousOutput as { fromB: boolean }).fromB).toBe(true);
  });

  it("can resume from the first step (no prior steps to replay)", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        { id: "step-a", type: "code", run: () => { executed.push("step-a"); throw new Error("fail"); } },
        { id: "step-b", type: "code", run: () => { executed.push("step-b"); return "ok"; } },
      ],
    });

    const original = await runDefinition(definition);
    expect(original.metadata.status).toBe("failed");
    const originalId = original.metadata.id;
    executed.length = 0;

    const resumeDefinition = makeDefinition({
      steps: [
        { id: "step-a", type: "code", run: () => { executed.push("step-a"); return "fixed"; } },
        { id: "step-b", type: "code", run: () => { executed.push("step-b"); return "ok"; } },
      ],
    });

    const resumed = await runDefinition(resumeDefinition, {
      event: "resume",
      payload: { resumedFromRunId: originalId, resumeFromStep: "step-a" },
    });

    expect(executed).toEqual(["step-a", "step-b"]);
    expect(resumed.metadata.status).toBe("success");
    expect(resumed.metadata.steps).toHaveLength(2);
    expect(resumed.metadata.steps[0]!.reused).toBeUndefined();
  });

  it("links resumed run to source run via resumedFromRunId in persisted metadata", async () => {
    const definition = makeDefinition({
      steps: [
        { id: "step-a", type: "code", run: () => ({ ok: true }) },
        { id: "step-b", type: "code", run: () => { throw new Error("fail"); } },
      ],
    });

    const original = await runDefinition(definition);
    const originalId = original.metadata.id;

    const resumeDefinition = makeDefinition({
      steps: [
        { id: "step-a", type: "code", run: () => ({ ok: true }) },
        { id: "step-b", type: "code", run: () => "fixed" },
      ],
    });

    const resumed = await runDefinition(resumeDefinition, {
      event: "resume",
      payload: { resumedFromRunId: originalId, resumeFromStep: "step-b" },
    });

    expect(resumed.metadata.resumedFromRunId).toBe(originalId);

    // Verify persisted metadata has resumedFromRunId
    const dirs = readdirSync(join(projectDir, ".kota", "runs")).sort().reverse();
    const resumeRunId = dirs[0]!;
    const persisted = readRunMetadata(resumeRunId);
    expect(persisted.resumedFromRunId).toBe(originalId);
  });

  it("fails the run when the source run does not exist", async () => {
    const definition = makeDefinition({
      steps: [{ id: "step-a", type: "code", run: () => "ok" }],
    });

    const result = await runDefinition(definition, {
      event: "resume",
      payload: { resumedFromRunId: "nonexistent-run-id", resumeFromStep: "step-a" },
    });

    expect(result.metadata.status).toBe("failed");
  });
});
