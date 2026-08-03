import { describe, expect, it } from "vitest";
import { decodeDecompositionPlan } from "./decomposition-plan.js";

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

  it("rejects dependencies on the same or a later subtask", () => {
    expect(() =>
      decodeDecompositionPlan({
        rationale: "Invalid ordering.",
        subtasks: [subtask([0])],
      }),
    ).toThrow(/earlier subtask index/);
  });
});
