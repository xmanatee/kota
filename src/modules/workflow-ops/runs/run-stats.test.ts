import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeStatsRows } from "./run-stats.js";

let dirCounter = 0;
function makeRunsDir(): string {
  const base = join(tmpdir(), `kota-stats-test-${Date.now()}-${dirCounter++}`);
  mkdirSync(base, { recursive: true });
  return base;
}

function writeRun(
  runsDir: string,
  id: string,
  workflow: string,
  status: string,
  startedAt: string,
  durationMs?: number,
  totalCostUsd?: number,
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  const completedAt = durationMs
    ? new Date(new Date(startedAt).getTime() + durationMs).toISOString()
    : undefined;
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({ id, workflow, status, startedAt, completedAt, durationMs, totalCostUsd }),
  );
}

describe("computeStatsRows", () => {
  it("returns empty when no runs in window", () => {
    const runsDir = makeRunsDir();
    const rows = computeStatsRows(runsDir, Date.now() - 1000);
    expect(rows).toEqual([]);
  });

  it("aggregates success, failure counts and cost per workflow", () => {
    const runsDir = makeRunsDir();
    const now = new Date().toISOString();
    writeRun(runsDir, "r1", "builder", "success", now, 60_000, 0.10);
    writeRun(runsDir, "r2", "builder", "failed", now, 30_000, 0.05);
    writeRun(runsDir, "r3", "explorer", "success", now, 120_000, 0.20);
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const rows = computeStatsRows(runsDir, cutoffMs);

    expect(rows).toHaveLength(2);
    const builder = rows.find((r) => r.workflow === "builder")!;
    expect(builder.runs).toBe(2);
    expect(builder.successes).toBe(1);
    expect(builder.failures).toBe(1);
    expect(builder.totalCostUsd).toBeCloseTo(0.15);
    expect(builder.avgDurationMs).toBeCloseTo(45_000);

    const explorer = rows.find((r) => r.workflow === "explorer")!;
    expect(explorer.runs).toBe(1);
    expect(explorer.successes).toBe(1);
    expect(explorer.failures).toBe(0);
    expect(explorer.totalCostUsd).toBeCloseTo(0.20);
  });

  it("filters by workflow name when specified", () => {
    const runsDir = makeRunsDir();
    const now = new Date().toISOString();
    writeRun(runsDir, "r1", "builder", "success", now, 60_000, 0.10);
    writeRun(runsDir, "r2", "explorer", "success", now, 30_000, 0.05);
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const rows = computeStatsRows(runsDir, cutoffMs, "builder");
    expect(rows).toHaveLength(1);
    expect(rows[0].workflow).toBe("builder");
  });

  it("excludes runs older than cutoff", () => {
    const runsDir = makeRunsDir();
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    writeRun(runsDir, "r1", "builder", "success", old, 60_000, 0.10);
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const rows = computeStatsRows(runsDir, cutoffMs);
    expect(rows).toEqual([]);
  });

  it("excludes running runs from aggregate", () => {
    const runsDir = makeRunsDir();
    const now = new Date().toISOString();
    writeRun(runsDir, "r1", "builder", "success", now, 60_000, 0.10);
    writeRun(runsDir, "r2", "builder", "running", now);
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const rows = computeStatsRows(runsDir, cutoffMs);
    const builder = rows.find((r) => r.workflow === "builder")!;
    expect(builder.runs).toBe(1);
  });
});
