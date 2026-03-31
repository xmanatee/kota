import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCsv, loadRunSummaries } from "./run-export.js";

let counter = 0;
function makeRunsDir(): string {
  const base = join(tmpdir(), `kota-export-test-${Date.now()}-${counter++}`);
  mkdirSync(base, { recursive: true });
  return base;
}

function writeRun(
  runsDir: string,
  meta: {
    id: string;
    workflow: string;
    status: string;
    startedAt: string;
    durationMs?: number;
    totalCostUsd?: number;
    steps?: unknown[];
    trigger?: { event: string; payload: Record<string, unknown> };
  },
): void {
  const dir = join(runsDir, meta.id);
  mkdirSync(dir, { recursive: true });
  const record = {
    ...meta,
    trigger: meta.trigger ?? { event: "manual", payload: {} },
    steps: meta.steps ?? [],
  };
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(record));
}

describe("loadRunSummaries", () => {
  it("returns empty array when no runs exist", () => {
    const runsDir = makeRunsDir();
    expect(loadRunSummaries(runsDir, {})).toEqual([]);
  });

  it("returns run summaries sorted by id descending", () => {
    const runsDir = makeRunsDir();
    const now = new Date().toISOString();
    writeRun(runsDir, { id: "2024-01-01-builder-aaa", workflow: "builder", status: "success", startedAt: now, durationMs: 60000, totalCostUsd: 0.1, steps: [{}, {}] });
    writeRun(runsDir, { id: "2024-01-02-explorer-bbb", workflow: "explorer", status: "failed", startedAt: now, durationMs: 30000, totalCostUsd: 0.05 });
    const summaries = loadRunSummaries(runsDir, {});
    expect(summaries).toHaveLength(2);
    expect(summaries[0].id).toBe("2024-01-02-explorer-bbb");
    expect(summaries[1].id).toBe("2024-01-01-builder-aaa");
  });

  it("maps fields to RunSummary correctly", () => {
    const runsDir = makeRunsDir();
    const startedAt = new Date().toISOString();
    writeRun(runsDir, {
      id: "run-1",
      workflow: "builder",
      status: "success",
      startedAt,
      durationMs: 5000,
      totalCostUsd: 0.25,
      steps: [{ id: "a" }, { id: "b" }, { id: "c" }],
      trigger: { event: "workflow.completed", payload: {} },
    });
    const [s] = loadRunSummaries(runsDir, {});
    expect(s.id).toBe("run-1");
    expect(s.workflow).toBe("builder");
    expect(s.status).toBe("success");
    expect(s.triggerEvent).toBe("workflow.completed");
    expect(s.startedAt).toBe(startedAt);
    expect(s.durationMs).toBe(5000);
    expect(s.stepCount).toBe(3);
    expect(s.totalCostUsd).toBe(0.25);
  });

  it("uses null for missing optional fields", () => {
    const runsDir = makeRunsDir();
    writeRun(runsDir, { id: "run-no-cost", workflow: "builder", status: "failed", startedAt: new Date().toISOString() });
    const [s] = loadRunSummaries(runsDir, {});
    expect(s.durationMs).toBeNull();
    expect(s.totalCostUsd).toBeNull();
    expect(s.stepCount).toBe(0);
  });

  it("filters by workflow", () => {
    const runsDir = makeRunsDir();
    const now = new Date().toISOString();
    writeRun(runsDir, { id: "r1", workflow: "builder", status: "success", startedAt: now });
    writeRun(runsDir, { id: "r2", workflow: "explorer", status: "success", startedAt: now });
    const summaries = loadRunSummaries(runsDir, { workflow: "builder" });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].workflow).toBe("builder");
  });

  it("filters by status", () => {
    const runsDir = makeRunsDir();
    const now = new Date().toISOString();
    writeRun(runsDir, { id: "r1", workflow: "builder", status: "success", startedAt: now });
    writeRun(runsDir, { id: "r2", workflow: "builder", status: "failed", startedAt: now });
    const summaries = loadRunSummaries(runsDir, { status: "failed" });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].status).toBe("failed");
  });

  it("filters by sinceMs", () => {
    const runsDir = makeRunsDir();
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    writeRun(runsDir, { id: "r-old", workflow: "builder", status: "success", startedAt: old });
    writeRun(runsDir, { id: "r-new", workflow: "builder", status: "success", startedAt: recent });
    const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
    const summaries = loadRunSummaries(runsDir, { sinceMs });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe("r-new");
  });

  it("respects --last limit", () => {
    const runsDir = makeRunsDir();
    const now = new Date().toISOString();
    for (let i = 1; i <= 5; i++) {
      writeRun(runsDir, { id: `r-00${i}`, workflow: "builder", status: "success", startedAt: now });
    }
    const summaries = loadRunSummaries(runsDir, { last: 3 });
    expect(summaries).toHaveLength(3);
  });
});

describe("formatCsv", () => {
  it("outputs header row and one data row", () => {
    const summaries = [
      {
        id: "run-abc",
        workflow: "builder",
        status: "success",
        triggerEvent: "manual",
        startedAt: "2024-01-01T00:00:00.000Z",
        durationMs: 60000,
        stepCount: 2,
        totalCostUsd: 0.1,
      },
    ];
    const csv = formatCsv(summaries);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("id,workflow,status,triggerEvent,startedAt,durationMs,stepCount,totalCostUsd");
    expect(lines[1]).toBe("run-abc,builder,success,manual,2024-01-01T00:00:00.000Z,60000,2,0.1");
  });

  it("outputs only header row for empty summaries", () => {
    const csv = formatCsv([]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^id,/);
  });

  it("writes empty string for null fields", () => {
    const summaries = [
      {
        id: "run-x",
        workflow: "builder",
        status: "failed",
        triggerEvent: "cron",
        startedAt: "2024-06-01T10:00:00.000Z",
        durationMs: null,
        stepCount: 0,
        totalCostUsd: null,
      },
    ];
    const csv = formatCsv(summaries);
    const dataLine = csv.trim().split("\n")[1];
    expect(dataLine).toBe("run-x,builder,failed,cron,2024-06-01T10:00:00.000Z,,0,");
  });

  it("escapes commas in values with double quotes", () => {
    const summaries = [
      {
        id: "run-y",
        workflow: "has,comma",
        status: "success",
        triggerEvent: "manual",
        startedAt: "2024-01-01T00:00:00.000Z",
        durationMs: 1000,
        stepCount: 1,
        totalCostUsd: 0.01,
      },
    ];
    const csv = formatCsv(summaries);
    expect(csv).toContain('"has,comma"');
  });

  it("produces stable column order", () => {
    const csv = formatCsv([]);
    expect(csv.startsWith("id,workflow,status,triggerEvent,startedAt,durationMs,stepCount,totalCostUsd")).toBe(true);
  });
});
