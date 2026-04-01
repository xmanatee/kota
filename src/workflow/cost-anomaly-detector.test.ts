import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectCostAnomaly } from "./cost-anomaly-detector.js";
import { WorkflowRunStore } from "./run-store.js";

function writeMetadata(
  runsDir: string,
  id: string,
  totalCostUsd: number,
  status: "success" | "failed" | "interrupted" | "completed-with-warnings" = "success",
  workflow = "builder",
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      id,
      workflow,
      definitionPath: `test/${workflow}.ts`,
      trigger: { event: "runtime.idle", payload: {} },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      status,
      totalCostUsd,
      steps: [],
    }),
  );
}

describe("detectCostAnomaly", () => {
  let projectDir: string;
  let store: WorkflowRunStore;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-anomaly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns null when fewer than 3 historical runs exist", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    writeMetadata(runsDir, "run-1", 0.01);
    writeMetadata(runsDir, "run-2", 0.01);
    const result = detectCostAnomaly(store, "builder", "run-current", 1.0, 3.0);
    expect(result).toBeNull();
  });

  it("returns null when run cost is within threshold", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    writeMetadata(runsDir, "run-1", 0.10);
    writeMetadata(runsDir, "run-2", 0.10);
    writeMetadata(runsDir, "run-3", 0.10);
    // current cost = 0.25, baseline = 0.10, threshold = 3.0, 0.25 < 0.30 → no anomaly
    const result = detectCostAnomaly(store, "builder", "run-current", 0.25, 3.0);
    expect(result).toBeNull();
  });

  it("detects anomaly when run cost exceeds threshold × baseline", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    writeMetadata(runsDir, "run-1", 0.10);
    writeMetadata(runsDir, "run-2", 0.10);
    writeMetadata(runsDir, "run-3", 0.10);
    // current cost = 0.50, baseline = 0.10, threshold = 3.0, 0.50 > 0.30 → anomaly
    const result = detectCostAnomaly(store, "builder", "run-current", 0.50, 3.0);
    expect(result).not.toBeNull();
    expect(result!.baselineCostUsd).toBeCloseTo(0.10);
    expect(result!.historicalRunCount).toBe(3);
    expect(result!.text).toContain("builder");
    expect(result!.text).toContain("run-current");
  });

  it("excludes failed runs from baseline", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    // Two successful at 0.10, one failed at 1.00 (should be excluded)
    writeMetadata(runsDir, "run-1", 0.10, "success");
    writeMetadata(runsDir, "run-2", 0.10, "success");
    writeMetadata(runsDir, "run-3", 1.00, "failed");
    // Only 2 non-failed runs — below MIN_HISTORY_RUNS of 3 → null
    const result = detectCostAnomaly(store, "builder", "run-current", 5.0, 3.0);
    expect(result).toBeNull();
  });

  it("excludes interrupted runs from baseline", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    writeMetadata(runsDir, "run-1", 0.10, "success");
    writeMetadata(runsDir, "run-2", 0.10, "success");
    writeMetadata(runsDir, "run-3", 2.00, "interrupted");
    const result = detectCostAnomaly(store, "builder", "run-current", 5.0, 3.0);
    expect(result).toBeNull();
  });

  it("includes completed-with-warnings runs in baseline", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    writeMetadata(runsDir, "run-1", 0.10, "completed-with-warnings");
    writeMetadata(runsDir, "run-2", 0.10, "completed-with-warnings");
    writeMetadata(runsDir, "run-3", 0.10, "completed-with-warnings");
    const result = detectCostAnomaly(store, "builder", "run-current", 0.50, 3.0);
    expect(result).not.toBeNull();
    expect(result!.baselineCostUsd).toBeCloseTo(0.10);
  });

  it("excludes the current run from the baseline calculation", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    writeMetadata(runsDir, "run-current", 5.0); // would skew baseline if included
    writeMetadata(runsDir, "run-1", 0.10);
    writeMetadata(runsDir, "run-2", 0.10);
    writeMetadata(runsDir, "run-3", 0.10);
    const result = detectCostAnomaly(store, "builder", "run-current", 5.0, 3.0);
    expect(result).not.toBeNull();
    expect(result!.baselineCostUsd).toBeCloseTo(0.10);
    expect(result!.historicalRunCount).toBe(3);
  });

  it("does not cross-contaminate runs from different workflows", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    // Three explorer runs at 0.10 each — should not be used for builder baseline
    writeMetadata(runsDir, "exp-1", 0.10, "success", "explorer");
    writeMetadata(runsDir, "exp-2", 0.10, "success", "explorer");
    writeMetadata(runsDir, "exp-3", 0.10, "success", "explorer");
    // No builder history — should return null
    const result = detectCostAnomaly(store, "builder", "run-current", 5.0, 3.0);
    expect(result).toBeNull();
  });

  it("returns null when baseline is zero", () => {
    const runsDir = join(projectDir, ".kota", "runs");
    writeMetadata(runsDir, "run-1", 0);
    writeMetadata(runsDir, "run-2", 0);
    writeMetadata(runsDir, "run-3", 0);
    const result = detectCostAnomaly(store, "builder", "run-current", 1.0, 3.0);
    expect(result).toBeNull();
  });
});
