import { describe, expect, it } from "vitest";
import type { WorkflowRunMetadata } from "../../workflow/run-types.js";
import { buildRunDiff, formatRunDiff } from "./run-diff.js";

function makeRun(
  id: string,
  workflow: string,
  steps: Array<{
    id: string;
    status?: "success" | "failed" | "skipped";
    durationMs?: number;
    costUsd?: number;
  }>,
): WorkflowRunMetadata {
  return {
    id,
    workflow,
    definitionPath: "",
    trigger: { event: "manual", payload: {} },
    startedAt: "2026-01-01T00:00:00Z",
    status: "success",
    runDir: "",
    steps: steps.map((s) => ({
      id: s.id,
      type: "agent" as const,
      status: s.status ?? "success",
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:00:01Z",
      durationMs: s.durationMs ?? 1000,
      output: s.costUsd !== undefined ? { totalCostUsd: s.costUsd } : undefined,
    })),
  };
}

describe("buildRunDiff", () => {
  it("produces one entry per step when steps match", () => {
    const a = makeRun("a", "builder", [
      { id: "build", durationMs: 45000 },
      { id: "validate", durationMs: 2300 },
    ]);
    const b = makeRun("b", "builder", [
      { id: "build", durationMs: 62000 },
      { id: "validate", durationMs: 1100 },
    ]);
    const diffs = buildRunDiff(a, b);
    expect(diffs).toHaveLength(2);
    expect(diffs[0].id).toBe("build");
    expect(diffs[0].durMsA).toBe(45000);
    expect(diffs[0].durMsB).toBe(62000);
  });

  it("shows null statusB for steps only in A", () => {
    const a = makeRun("a", "builder", [
      { id: "build" },
      { id: "notify" },
    ]);
    const b = makeRun("b", "builder", [{ id: "build" }]);
    const diffs = buildRunDiff(a, b);
    const notify = diffs.find((d) => d.id === "notify");
    expect(notify).toBeDefined();
    expect(notify!.statusA).toBe("success");
    expect(notify!.statusB).toBeNull();
    expect(notify!.durMsB).toBeNull();
  });

  it("shows null statusA for steps only in B", () => {
    const a = makeRun("a", "builder", [{ id: "build" }]);
    const b = makeRun("b", "builder", [
      { id: "build" },
      { id: "deploy" },
    ]);
    const diffs = buildRunDiff(a, b);
    const deploy = diffs.find((d) => d.id === "deploy");
    expect(deploy).toBeDefined();
    expect(deploy!.statusA).toBeNull();
    expect(deploy!.statusB).toBe("success");
  });

  it("extracts cost from step output", () => {
    const a = makeRun("a", "builder", [{ id: "build", costUsd: 0.023 }]);
    const b = makeRun("b", "builder", [{ id: "build", costUsd: 0.031 }]);
    const diffs = buildRunDiff(a, b);
    expect(diffs[0].costA).toBeCloseTo(0.023);
    expect(diffs[0].costB).toBeCloseTo(0.031);
  });

  it("returns null cost when step has no cost output", () => {
    const a = makeRun("a", "builder", [{ id: "build" }]);
    const b = makeRun("b", "builder", [{ id: "build" }]);
    const diffs = buildRunDiff(a, b);
    expect(diffs[0].costA).toBeNull();
    expect(diffs[0].costB).toBeNull();
  });
});

describe("formatRunDiff", () => {
  it("fits in 80 columns when there is no cost", () => {
    const a = makeRun("2026-01-01T00-00-00Z-builder-aaaa", "builder", [
      { id: "build", durationMs: 45000 },
    ]);
    const b = makeRun("2026-01-01T00-00-01Z-builder-bbbb", "builder", [
      { id: "build", durationMs: 62100 },
    ]);
    const output = formatRunDiff(a, b);
    for (const line of output.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it("includes run IDs in the header lines", () => {
    const a = makeRun("run-a", "builder", [{ id: "build" }]);
    const b = makeRun("run-b", "builder", [{ id: "build" }]);
    const output = formatRunDiff(a, b);
    expect(output).toContain("run-a");
    expect(output).toContain("run-b");
  });

  it("shows N/A for steps only in one run", () => {
    const a = makeRun("run-a", "builder", [
      { id: "build" },
      { id: "only-a" },
    ]);
    const b = makeRun("run-b", "builder", [{ id: "build" }]);
    const output = formatRunDiff(a, b);
    expect(output).toContain("N/A");
  });

  it("shows cost columns when any step has cost", () => {
    const a = makeRun("run-a", "builder", [{ id: "build", costUsd: 0.01 }]);
    const b = makeRun("run-b", "builder", [{ id: "build", costUsd: 0.02 }]);
    const output = formatRunDiff(a, b);
    expect(output).toContain("Cost");
    expect(output).toContain("$0.010");
    expect(output).toContain("$0.020");
  });

  it("omits cost columns when no step has cost", () => {
    const a = makeRun("run-a", "builder", [{ id: "build" }]);
    const b = makeRun("run-b", "builder", [{ id: "build" }]);
    const output = formatRunDiff(a, b);
    expect(output).not.toContain("Cost");
    expect(output).not.toContain("$");
  });

  it("shows regressed status as status-a arrow status-b", () => {
    const a = makeRun("run-a", "builder", [{ id: "build", status: "success" }]);
    const b = makeRun("run-b", "builder", [{ id: "build", status: "failed" }]);
    const output = formatRunDiff(a, b);
    expect(output).toContain("✓→✗");
  });
});
