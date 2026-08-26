import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getEligibleAtMs } from "./run-executor-utils.js";
import { RunStateDatabase } from "./run-state-database.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("durable workflow cooldown projection", () => {
  it("keeps independent concurrent completions and uses the latest watermark", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-cooldown-state-"));
    roots.push(root);
    const database = new RunStateDatabase(root);
    database.registerScope({
      id: "project",
      rootPath: root,
      createdAt: "2026-04-11T09:00:00.000Z",
    });
    const { epoch } = database.beginDaemonSession("2026-04-11T09:00:00.000Z");
    for (const [id, workflow] of [["alpha-run", "alpha"], ["beta-run", "beta"]] as const) {
      database.admitRun({
        id,
        scopeId: "project",
        workflow,
        trigger: { event: "test", schemaRef: null, payload: {} },
        repository: "none",
        resources: [],
        admittedAt: "2026-04-11T09:01:00.000Z",
      });
      database.startRun(id, epoch, "2026-04-11T09:02:00.000Z");
    }
    database.finishRun(
      "beta-run",
      epoch,
      "succeeded",
      "2026-04-11T10:03:00.000Z",
    );
    database.finishRun(
      "alpha-run",
      epoch,
      "succeeded",
      "2026-04-11T10:04:00.000Z",
    );

    const summary = database.readWorkflowSummary("project");
    expect(summary).toMatchObject({
      completedRuns: 2,
      workflows: {
        alpha: { lastCompletion: { runId: "alpha-run" } },
        beta: { lastCompletion: { runId: "beta-run" } },
      },
    });
    expect(getEligibleAtMs("alpha", 60_000, summary)).toBe(
      Date.parse("2026-04-11T10:05:00.000Z"),
    );
    database.close();
  });
});
