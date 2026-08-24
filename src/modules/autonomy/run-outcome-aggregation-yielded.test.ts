import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  aggregateRunOutcomes,
  tallyRepairFailures,
} from "./run-outcome-aggregation.js";

describe("yielded run outcome aggregation", () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), "kota-yielded-aggregation-"));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it("does not classify a yielded repair lineage as terminal or recovered", () => {
    const run: WorkflowRunMetadata = {
      id: "run-yielded",
      workflow: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
      startedAt: "2026-04-16T00:00:00.000Z",
      status: "yielded",
      runDir: "run-yielded",
      steps: [{
        id: "build",
        type: "agent",
        status: "yielded",
        startedAt: "2026-04-16T00:00:00.000Z",
        completedAt: "2026-04-16T00:00:01.000Z",
        durationMs: 1_000,
        output: {
          repairIterations: [{
            attempt: 1,
            failures: [{ id: "critic-review" }],
          }],
        },
      }],
    };
    expect(tallyRepairFailures([run])).toEqual([]);
  });

  it("excludes yielded runs from failure-rate totals", () => {
    const writeRun = (
      id: string,
      status: WorkflowRunMetadata["status"],
    ): void => {
      const runDir = join(runsDir, id);
      mkdirSync(runDir, { recursive: true });
      const now = new Date().toISOString();
      const metadata: WorkflowRunMetadata = {
        id,
        workflow: "builder",
        definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
        startedAt: now,
        completedAt: now,
        status,
        durationMs: 1_000,
        runDir: id,
        steps: [],
      };
      writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata));
    };
    writeRun("success", "success");
    writeRun("failed", "failed");
    writeRun("interrupted", "interrupted");
    writeRun("yielded", "yielded");

    expect(aggregateRunOutcomes(runsDir).failureRates7d).toContainEqual({
      workflow: "builder",
      total: 2,
      failures: 1,
      rate: 0.5,
    });
  });
});
