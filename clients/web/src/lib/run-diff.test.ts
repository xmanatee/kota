import type { WorkflowRunDetail } from "@/api/types";
import { describe, expect, it } from "vitest";
import { buildRunComparison } from "./run-diff";

function makeRun(overrides: Partial<WorkflowRunDetail>): WorkflowRunDetail {
  return {
    id: "run-x",
    workflow: "builder",
    status: "success",
    triggerEvent: "autonomy.queue.available",
    startedAt: "2026-05-03T00:00:00.000Z",
    durationMs: 1000,
    totalCostUsd: 1,
    steps: [],
    ...overrides,
  };
}

describe("buildRunComparison", () => {
  it("merges steps by id, preserving A order then appending B-only steps", () => {
    const a = makeRun({
      id: "run-a",
      steps: [
        { id: "plan", type: "agent", status: "success", durationMs: 100 },
        { id: "build", type: "agent", status: "success", durationMs: 500 },
      ],
    });
    const b = makeRun({
      id: "run-b",
      steps: [
        { id: "plan", type: "agent", status: "success", durationMs: 110 },
        { id: "verify", type: "code", status: "success", durationMs: 200 },
      ],
    });
    const cmp = buildRunComparison(a, b);
    expect(cmp.steps.map((s) => s.id)).toEqual(["plan", "build", "verify"]);
    const planDiff = cmp.steps[0]!;
    expect(planDiff.statusA).toBe("success");
    expect(planDiff.statusB).toBe("success");
    expect(planDiff.durMsA).toBe(100);
    expect(planDiff.durMsB).toBe(110);
    const buildDiff = cmp.steps[1]!;
    expect(buildDiff.statusB).toBeNull();
    expect(buildDiff.durMsB).toBeNull();
    const verifyDiff = cmp.steps[2]!;
    expect(verifyDiff.statusA).toBeNull();
    expect(verifyDiff.statusB).toBe("success");
  });

  it("flags outcome change and computes total deltas", () => {
    const a = makeRun({
      status: "failed",
      durationMs: 1200,
      totalCostUsd: 0.5,
    });
    const b = makeRun({
      status: "success",
      durationMs: 900,
      totalCostUsd: 0.3,
    });
    const cmp = buildRunComparison(a, b);
    expect(cmp.outcomeChanged).toBe(true);
    expect(cmp.totalDurDelta).toBe(-300);
    expect(cmp.totalCostDelta).toBeCloseTo(-0.2, 5);
  });

  it("treats missing cost or duration as null and yields null deltas", () => {
    const a = makeRun({ totalCostUsd: undefined, durationMs: undefined });
    const b = makeRun({ totalCostUsd: 0.1, durationMs: 100 });
    const cmp = buildRunComparison(a, b);
    expect(cmp.totalCostA).toBeNull();
    expect(cmp.totalCostDelta).toBeNull();
    expect(cmp.totalDurMsA).toBeNull();
    expect(cmp.totalDurDelta).toBeNull();
  });

  it("rejects different workflows", () => {
    const a = makeRun({ workflow: "builder" });
    const b = makeRun({ workflow: "explorer" });
    expect(() => buildRunComparison(a, b)).toThrow(/different workflows/);
  });
});
