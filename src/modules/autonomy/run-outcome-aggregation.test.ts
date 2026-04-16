import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  WorkflowRunMetadata,
  WorkflowStepResult,
  WorkflowStepStatus,
} from "#core/workflow/run-types.js";
import {
  aggregateRunOutcomes,
  findDurationOutliers,
  tallyRepairFailures,
} from "./run-outcome-aggregation.js";

type Iter = { attempt: number; failures: Array<{ id: string }> };

function makeStep(
  id: string,
  status: WorkflowStepStatus,
  iterations: Iter[],
): WorkflowStepResult {
  return {
    id,
    type: "agent",
    status,
    startedAt: "2026-04-16T00:00:00.000Z",
    completedAt: "2026-04-16T00:00:01.000Z",
    durationMs: 1000,
    output: { repairIterations: iterations },
  };
}

function makeRun(steps: WorkflowStepResult[]): WorkflowRunMetadata {
  return {
    id: "run-1",
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "runtime.idle", payload: {} },
    startedAt: "2026-04-16T00:00:00.000Z",
    status: "success",
    runDir: "run-1",
    steps,
  };
}

describe("tallyRepairFailures", () => {
  it("counts a persistent check once per step, not once per iteration", () => {
    const run = makeRun([
      makeStep("build", "success", [
        { attempt: 1, failures: [{ id: "critic-review" }] },
        { attempt: 2, failures: [{ id: "critic-review" }] },
        { attempt: 3, failures: [{ id: "critic-review" }] },
      ]),
    ]);
    const tally = tallyRepairFailures([run]);
    expect(tally).toEqual([
      { checkId: "critic-review", count: 1, recovered: 1, terminal: 0 },
    ]);
  });

  it("labels failures in a successful step as recovered", () => {
    const run = makeRun([
      makeStep("build", "success", [
        { attempt: 1, failures: [{ id: "typecheck" }, { id: "lint" }] },
      ]),
    ]);
    const tally = tallyRepairFailures([run]);
    expect(tally).toEqual([
      { checkId: "typecheck", count: 1, recovered: 1, terminal: 0 },
      { checkId: "lint", count: 1, recovered: 1, terminal: 0 },
    ]);
  });

  it("labels a persistent failure in a failed step as terminal, never as recovered", () => {
    const run = makeRun([
      makeStep("build", "failed", [
        { attempt: 1, failures: [{ id: "typecheck" }, { id: "lint" }] },
        { attempt: 2, failures: [{ id: "typecheck" }, { id: "build-output" }] },
      ]),
    ]);
    const tally = tallyRepairFailures([run]);
    const byId = new Map(tally.map((t) => [t.checkId, t]));
    expect(byId.get("typecheck")).toEqual({
      checkId: "typecheck",
      count: 1,
      recovered: 0,
      terminal: 1,
    });
    expect(byId.get("build-output")).toEqual({
      checkId: "build-output",
      count: 1,
      recovered: 0,
      terminal: 1,
    });
    expect(byId.get("lint")).toEqual({
      checkId: "lint",
      count: 1,
      recovered: 1,
      terminal: 0,
    });
  });

  it("aggregates across runs and sorts by count descending", () => {
    const runs = [
      makeRun([
        makeStep("build", "success", [
          { attempt: 1, failures: [{ id: "critic-review" }] },
        ]),
      ]),
      makeRun([
        makeStep("build", "success", [
          { attempt: 1, failures: [{ id: "critic-review" }, { id: "typecheck" }] },
        ]),
      ]),
      makeRun([
        makeStep("build", "failed", [
          { attempt: 1, failures: [{ id: "critic-review" }] },
        ]),
      ]),
    ];
    const tally = tallyRepairFailures(runs);
    expect(tally[0]).toEqual({
      checkId: "critic-review",
      count: 3,
      recovered: 2,
      terminal: 1,
    });
    expect(tally[1]).toEqual({
      checkId: "typecheck",
      count: 1,
      recovered: 1,
      terminal: 0,
    });
  });

  it("ignores steps with no repair iterations", () => {
    const run = makeRun([
      {
        id: "plain",
        type: "agent",
        status: "success",
        startedAt: "2026-04-16T00:00:00.000Z",
        completedAt: "2026-04-16T00:00:01.000Z",
        durationMs: 1000,
        output: { content: "done" },
      },
    ]);
    expect(tallyRepairFailures([run])).toEqual([]);
  });
});

function makeWorkflowRun(
  id: string,
  workflow: string,
  durationMs: number,
  agentStepDurationMs: number,
  agentStepStatus: WorkflowStepStatus = "success",
  runStatus: WorkflowRunMetadata["status"] = "success",
): WorkflowRunMetadata {
  return {
    id,
    workflow,
    definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
    trigger: { event: "runtime.idle", payload: {} },
    startedAt: "2026-04-16T00:00:00.000Z",
    status: runStatus,
    durationMs,
    runDir: id,
    steps: [
      {
        id: "gate",
        type: "code",
        status: "success",
        startedAt: "2026-04-16T00:00:00.000Z",
        completedAt: "2026-04-16T00:00:00.050Z",
        durationMs: 50,
      },
      {
        id: "agent-step",
        type: "agent",
        status: agentStepStatus,
        startedAt: "2026-04-16T00:00:00.050Z",
        completedAt: "2026-04-16T00:00:00.050Z",
        durationMs: agentStepDurationMs,
      },
    ],
  };
}

describe("findDurationOutliers", () => {
  it("ignores runs that skipped the agent step so the median reflects real execution", () => {
    // Explorer-shape: many quick-skip runs and a few real runs. If skips were
    // counted, the median collapses to ~50ms and every real run looks like an
    // outlier, defeating the signal.
    const skipped = Array.from({ length: 10 }, (_, i) =>
      makeWorkflowRun(`skip-${i}`, "explorer", 60, 0, "skipped"),
    );
    const real = [
      makeWorkflowRun("real-1", "explorer", 400_000, 399_000),
      makeWorkflowRun("real-2", "explorer", 500_000, 499_000),
      makeWorkflowRun("real-3", "explorer", 600_000, 599_000),
      makeWorkflowRun("real-outlier", "explorer", 2_000_000, 1_999_000),
    ];
    const outliers = findDurationOutliers([...skipped, ...real]);
    expect(outliers).toHaveLength(1);
    expect(outliers[0]).toMatchObject({
      runId: "real-outlier",
      workflow: "explorer",
    });
    expect(outliers[0].medianMs).toBeGreaterThan(100_000);
  });

  it("returns no outliers when fewer than 3 real runs exist", () => {
    const runs = [
      makeWorkflowRun("a", "builder", 1_000_000, 999_000),
      makeWorkflowRun("b", "builder", 5_000_000, 4_999_000),
    ];
    expect(findDurationOutliers(runs)).toEqual([]);
  });

  it("flags runs above 2.5x median among real runs", () => {
    const runs = [
      makeWorkflowRun("a", "builder", 500_000, 499_000),
      makeWorkflowRun("b", "builder", 600_000, 599_000),
      makeWorkflowRun("c", "builder", 700_000, 699_000),
      makeWorkflowRun("d", "builder", 2_000_000, 1_999_000),
    ];
    const outliers = findDurationOutliers(runs);
    expect(outliers).toHaveLength(1);
    expect(outliers[0].runId).toBe("d");
  });

  it("ignores failed runs so timeout ceilings and retry loops don't pollute the signal", () => {
    // Failed runs commonly hit the step timeout or exhaust retries; their
    // duration is driven by the failure mode, not by real agent execution.
    const runs = [
      makeWorkflowRun("ok-1", "builder", 500_000, 499_000),
      makeWorkflowRun("ok-2", "builder", 600_000, 599_000),
      makeWorkflowRun("ok-3", "builder", 700_000, 699_000),
      makeWorkflowRun("timeout", "builder", 3_600_000, 3_599_000, "failed", "failed"),
      makeWorkflowRun("provider-error", "builder", 1_800_000, 1_799_000, "failed", "failed"),
    ];
    const outliers = findDurationOutliers(runs);
    expect(outliers).toEqual([]);
  });
});

describe("aggregateRunOutcomes duration outlier enrichment", () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), "kota-aggregation-"));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeRun(
    id: string,
    workflow: string,
    durationMs: number,
    agentDurationMs: number,
    commitSubject?: string,
  ): void {
    const runDir = join(runsDir, id);
    mkdirSync(runDir, { recursive: true });
    const metadata: WorkflowRunMetadata = {
      id,
      workflow,
      definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
      trigger: { event: "runtime.idle", payload: {} },
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      status: "success",
      durationMs,
      runDir: id,
      steps: [
        {
          id: "gate",
          type: "code",
          status: "success",
          startedAt: "2026-04-16T00:00:00.000Z",
          completedAt: "2026-04-16T00:00:00.050Z",
          durationMs: 50,
        },
        {
          id: "agent-step",
          type: "agent",
          status: "success",
          startedAt: "2026-04-16T00:00:00.050Z",
          completedAt: "2026-04-16T00:00:00.050Z",
          durationMs: agentDurationMs,
        },
      ],
    };
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata));
    if (commitSubject) {
      writeFileSync(
        join(runDir, "run-summary.json"),
        JSON.stringify({
          runId: id,
          workflow,
          taskId: null,
          taskTitle: null,
          outcome: "success",
          commitSha: "abc123",
          commitMessage: `${commitSubject}\n\nExtended body.`,
          filesChanged: [],
          costUsd: 1,
          durationMs,
          completedAt: new Date().toISOString(),
        }),
      );
    }
  }

  it("includes commit subject from run-summary.json in duration outliers", () => {
    writeRun("baseline-1", "improver", 500_000, 499_000);
    writeRun("baseline-2", "improver", 600_000, 599_000);
    writeRun("baseline-3", "improver", 700_000, 699_000);
    writeRun(
      "outlier-1",
      "improver",
      2_500_000,
      2_499_000,
      "Exclude failed runs from duration-outlier signal",
    );

    const result = aggregateRunOutcomes(runsDir);
    expect(result.durationOutliers).toHaveLength(1);
    expect(result.durationOutliers[0]).toMatchObject({
      runId: "outlier-1",
      commitSubject: "Exclude failed runs from duration-outlier signal",
    });
  });

  it("omits commitSubject when the run has no run-summary.json", () => {
    writeRun("baseline-1", "improver", 500_000, 499_000);
    writeRun("baseline-2", "improver", 600_000, 599_000);
    writeRun("baseline-3", "improver", 700_000, 699_000);
    writeRun("outlier-1", "improver", 2_500_000, 2_499_000);

    const result = aggregateRunOutcomes(runsDir);
    expect(result.durationOutliers).toHaveLength(1);
    expect(result.durationOutliers[0].commitSubject).toBeUndefined();
  });
});
