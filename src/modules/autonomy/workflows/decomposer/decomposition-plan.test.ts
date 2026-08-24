import { describe, expect, it } from "vitest";
import {
  decodeDecompositionPlan,
  decodeDecompositionReview,
} from "./decomposition-plan.js";

function subtask(dependsOn: number[]) {
  return {
    title: "Scoped task",
    summary: "A bounded outcome.",
    priority: "p1",
    area: "core",
    taskClass: "Safety",
    problem: "The original task exhausted repair.",
    desiredOutcome: "The bounded outcome is complete.",
    constraints: ["Preserve authorization boundaries."],
    doneWhen: ["A focused regression passes."],
    sourceIntent: "Preserve the original safety finding.",
    initiative: "Safe autonomous execution.",
    acceptanceEvidence: ["A regression transcript proves the boundary."],
    reuseTaskId: null,
    dependsOn,
  };
}

describe("decodeDecompositionPlan", () => {
  it("accepts dependencies on earlier subtasks", () => {
    const result = decodeDecompositionPlan({
      rationale: "Two ordered execution slices.",
      subtasks: [subtask([]), { ...subtask([0]), title: "Second scoped task" }],
    });

    expect(result.subtasks[1]?.dependsOn).toEqual([0]);
  });

  it("accepts an explicit open-task reuse target", () => {
    const result = decodeDecompositionPlan({
      rationale: "Reuse the equivalent open slice instead of duplicating it.",
      subtasks: [{ ...subtask([]), reuseTaskId: "task-existing-safety-slice" }],
    });

    expect(result.subtasks[0]?.reuseTaskId).toBe("task-existing-safety-slice");
  });

  it("rejects a malformed reuse target", () => {
    expect(() =>
      decodeDecompositionPlan({
        rationale: "Invalid reuse identity.",
        subtasks: [{ ...subtask([]), reuseTaskId: "existing-safety-slice" }],
      }),
    ).toThrow();
  });

  it("rejects dependencies on the same or a later subtask", () => {
    expect(() =>
      decodeDecompositionPlan({
        rationale: "Invalid ordering.",
        subtasks: [subtask([0])],
      }),
    ).toThrow(/earlier subtask index/);
  });

  it("decodes an explicit semantic review decision", () => {
    expect(
      decodeDecompositionReview({
        decision: "reject",
        rationale: "The plan changes the parent task's security boundary.",
        issues: ["The plan addresses write attribution instead of live authority revocation."],
      }),
    ).toMatchObject({ decision: "reject" });
  });
});
