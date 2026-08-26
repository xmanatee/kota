import { describe, expect, it } from "vitest";
import type { AgentUsage } from "#core/agent-harness/usage.js";
import { computeWorkflowCostRows } from "./run-cost.js";

type RunEntry = { id: string; workflow: string; status: string; startedAt: string; usage?: AgentUsage };

function makeRun(id: string, workflow: string, status: string, totalCostUsd?: number): RunEntry {
  return {
    id,
    workflow,
    status,
    startedAt: new Date().toISOString(),
    ...(totalCostUsd === undefined
      ? {}
      : {
          usage: {
            tokens: { state: "unknown" },
            cost: { state: "complete", usd: totalCostUsd },
          } satisfies AgentUsage,
        }),
  };
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
    expect(builder.measuredCostUsd).toBeCloseTo(0.40);
    expect(builder.averageMeasuredCostUsd).toBeCloseTo(0.20);
    expect(builder.maxMeasuredRunCostUsd).toBeCloseTo(0.30);

    const explorer = rows.find((r) => r.workflow === "explorer")!;
    expect(explorer.runs).toBe(1);
    expect(explorer.measuredCostUsd).toBeCloseTo(0.05);
    expect(explorer.averageMeasuredCostUsd).toBeCloseTo(0.05);
    expect(explorer.maxMeasuredRunCostUsd).toBeCloseTo(0.05);
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

  it("preserves missing cost as unknown", () => {
    const rows = computeWorkflowCostRows([makeRun("r1", "builder", "success", undefined)]);
    expect(rows[0]).toMatchObject({
      measuredRuns: 0,
      unknownRuns: 1,
      measuredCostUsd: null,
      averageMeasuredCostUsd: null,
      maxMeasuredRunCostUsd: null,
    });
  });
});
