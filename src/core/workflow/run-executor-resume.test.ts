import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRunExecutorTestFixture,
  makeDefinition,
  type RunExecutorTestFixture,
  TRIGGER,
} from "./run-executor-test-fixture.js";
import { findResumeFromIndex } from "./run-executor-utils.js";
import type { WorkflowStepResult } from "./run-types.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

describe("findResumeFromIndex", () => {
  const defSteps = [{ id: "step-a" }, { id: "step-b" }, { id: "step-c" }];

  function makeStep(id: string, status: WorkflowStepResult["status"] = "success"): WorkflowStepResult {
    const timing = { id, startedAt: "", completedAt: "", durationMs: 0 };
    if (status === "skipped") {
      return {
        ...timing,
        type: "code",
        status,
        skipReason: { kind: "when-predicate" },
      };
    }
    return { ...timing, type: "code", status };
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

  it("treats a skipped prerequisite as completed and returns the resume index", () => {
    // A `when`-skipped step is a deliberate non-execution recorded by the
    // source run, not a partial state. Resume preserves the skip and does
    // not re-run the step, so it must not block the resume contract — for
    // example, `blocked-promoter` skips `reset-for-recovery` on
    // `autonomy.queue.available` triggers and would otherwise be unable to
    // resume across an await-event suspension on a daemon restart.
    const original = [makeStep("step-a", "skipped")];
    expect(findResumeFromIndex("step-b", defSteps, original)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resume execution
// ---------------------------------------------------------------------------

describe("resume execution", () => {
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

  it("resumes from a specific step, skipping prior steps", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        { id: "step-a", type: "code", run: () => { executed.push("step-a"); return { fromA: true }; } },
        { id: "step-b", type: "code", run: () => { executed.push("step-b"); throw new Error("transient"); } },
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

    // Fix step-b for the resume
    const resumeDefinition = makeDefinition({
      steps: [
        { id: "step-a", type: "code", run: () => { executed.push("step-a"); return { fromA: true }; } },
        { id: "step-b", type: "code", run: () => { executed.push("step-b"); return { fromB: true }; } },
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

    const resumeTrigger: WorkflowRunTrigger = {
      event: "resume",
      schemaRef: null, payload: { resumedFromRunId: originalId, resumeFromStep: "step-b" },
    };

    const resumed = await runDefinition(resumeDefinition, resumeTrigger);

    // Only step-b and step-c should have been re-executed
    expect(executed).toEqual(["step-b", "step-c"]);
    expect(resumed.metadata.status).toBe("success");
    expect(resumed.metadata.resumedFromRunId).toBe(originalId);
    expect(resumed.metadata.steps[2]?.output).toEqual({
      fromA: { fromA: true }, previous: { fromB: true },
    });
    expect(fixture.store.getRun(resumed.metadata.id)?.resumedFromRunId).toBe(originalId);

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
      schemaRef: null, payload: { resumedFromRunId: originalId, resumeFromStep: "step-a" },
    });

    expect(executed).toEqual(["step-a", "step-b"]);
    expect(resumed.metadata.status).toBe("success");
    expect(resumed.metadata.steps).toHaveLength(2);
    expect(resumed.metadata.steps[0]!.reused).toBeUndefined();
  });

  it("fails the run when the source run does not exist", async () => {
    const definition = makeDefinition({
      steps: [{ id: "step-a", type: "code", run: () => "ok" }],
    });

    const result = await runDefinition(definition, {
      event: "resume",
      schemaRef: null, payload: { resumedFromRunId: "nonexistent-run-id", resumeFromStep: "step-a" },
    });

    expect(result.metadata.status).toBe("failed");
  });
});
