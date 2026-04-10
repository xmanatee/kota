import { describe, expect, it } from "vitest";
import { computeWorkflowCostRows } from "./run-cost.js";

type RunEntry = { id: string; workflow: string; status: string; startedAt: string; totalCostUsd?: number };

function makeRun(id: string, workflow: string, status: string, totalCostUsd?: number): RunEntry {
  return { id, workflow, status, startedAt: new Date().toISOString(), totalCostUsd };
}

describe("computeWorkflowCostRows", () => {
  it("returns empty for no runs", () => {
    expect(computeWorkflowCostRows([])).toEqual([]);
  });

  it("excludes running runs", () => {
    const rows = computeWorkflowCostRows([makeRun("r1", "builder", "running", 0.5)]);
    expect(rows).toHaveLength(0);
  });

  it("computes total, average, and max per workflow", () => {
    const runs = [
      makeRun("r1", "builder", "success", 0.10),
      makeRun("r2", "builder", "success", 0.30),
      makeRun("r3", "explorer", "success", 0.05),
    ];
    const rows = computeWorkflowCostRows(runs);
    expect(rows).toHaveLength(2);

    const builder = rows.find((r) => r.workflow === "builder")!;
    expect(builder.runs).toBe(2);
    expect(builder.totalCostUsd).toBeCloseTo(0.40);
    expect(builder.averageCostUsd).toBeCloseTo(0.20);
    expect(builder.maxRunCostUsd).toBeCloseTo(0.30);

    const explorer = rows.find((r) => r.workflow === "explorer")!;
    expect(explorer.runs).toBe(1);
    expect(explorer.totalCostUsd).toBeCloseTo(0.05);
    expect(explorer.averageCostUsd).toBeCloseTo(0.05);
    expect(explorer.maxRunCostUsd).toBeCloseTo(0.05);
  });

  it("sorts by total cost descending", () => {
    const runs = [
      makeRun("r1", "explorer", "success", 0.01),
      makeRun("r2", "builder", "success", 0.50),
    ];
    const rows = computeWorkflowCostRows(runs);
    expect(rows[0].workflow).toBe("builder");
    expect(rows[1].workflow).toBe("explorer");
  });

  it("treats missing totalCostUsd as zero", () => {
    const rows = computeWorkflowCostRows([makeRun("r1", "builder", "success", undefined)]);
    expect(rows[0].totalCostUsd).toBe(0);
    expect(rows[0].averageCostUsd).toBe(0);
    expect(rows[0].maxRunCostUsd).toBe(0);
  });
});
