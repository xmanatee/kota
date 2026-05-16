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
      { workflow: "builder", checkId: "critic-review", count: 1, recovered: 1, terminal: 0 },
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
      { workflow: "builder", checkId: "typecheck", count: 1, recovered: 1, terminal: 0 },
      { workflow: "builder", checkId: "lint", count: 1, recovered: 1, terminal: 0 },
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
      workflow: "builder",
      checkId: "typecheck",
      count: 1,
      recovered: 0,
      terminal: 1,
    });
    expect(byId.get("build-output")).toEqual({
      workflow: "builder",
      checkId: "build-output",
      count: 1,
      recovered: 0,
      terminal: 1,
    });
    expect(byId.get("lint")).toEqual({
      workflow: "builder",
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
      workflow: "builder",
      checkId: "critic-review",
      count: 3,
      recovered: 2,
      terminal: 1,
    });
    expect(tally[1]).toEqual({
      workflow: "builder",
      checkId: "typecheck",
      count: 1,
      recovered: 1,
      terminal: 0,
    });
  });

  it("keeps the same repair check separate by workflow", () => {
    const improverRun = {
      ...makeRun([
        makeStep("improve", "failed", [
          { attempt: 1, failures: [{ id: "test" }] },
        ]),
      ]),
      id: "run-improver",
      workflow: "improver",
    };
    const builderRun = makeRun([
      makeStep("build", "success", [
        { attempt: 1, failures: [{ id: "test" }] },
      ]),
    ]);

    const tally = tallyRepairFailures([improverRun, builderRun]);

    expect(tally).toEqual(
      expect.arrayContaining([
        { workflow: "improver", checkId: "test", count: 1, recovered: 0, terminal: 1 },
        { workflow: "builder", checkId: "test", count: 1, recovered: 1, terminal: 0 },
      ]),
    );
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

  it("ignores numeric repair iteration summaries that are not detailed repair-loop evidence", () => {
    const run = makeRun([
      {
        id: "calibration",
        type: "code",
        status: "success",
        startedAt: "2026-04-16T00:00:00.000Z",
        completedAt: "2026-04-16T00:00:01.000Z",
        durationMs: 1000,
        output: { repairIterations: 1 },
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
    status: WorkflowRunMetadata["status"] = "success",
    completedAt?: string,
    repairFailureIds: string[] = [],
  ): void {
    const runDir = join(runsDir, id);
    mkdirSync(runDir, { recursive: true });
    const agentStepOutput = repairFailureIds.length
      ? {
          repairIterations: [
            {
              attempt: 1,
              failures: repairFailureIds.map((fid) => ({ id: fid })),
            },
          ],
        }
      : undefined;
    const metadata: WorkflowRunMetadata = {
      id,
      workflow,
      definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
      trigger: { event: "runtime.idle", payload: {} },
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      completedAt: completedAt ?? new Date(Date.now() - 30_000).toISOString(),
      status,
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
          output: agentStepOutput,
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

  it("excludes interrupted runs from failure-rate total and failures", () => {
    writeRun("ok-1", "improver", 500_000, 499_000);
    writeRun("ok-2", "improver", 600_000, 599_000);
    writeRun("fail-1", "improver", 400_000, 399_000, undefined, "failed");
    writeRun("abort-1", "improver", 100_000, 50_000, undefined, "interrupted");
    writeRun("abort-2", "improver", 200_000, 100_000, undefined, "interrupted");

    const result = aggregateRunOutcomes(runsDir);
    const improver = result.failureRates7d.find((r) => r.workflow === "improver");
    expect(improver).toEqual({
      workflow: "improver",
      total: 3,
      failures: 1,
      rate: 1 / 3,
    });
  });

  it("reports latestActionableRunAt as the newest completedAt across failed non-improver runs and ignores recovered repair trips", () => {
    writeRun(
      "ok-builder",
      "builder",
      500_000,
      499_000,
      undefined,
      "success",
      "2026-04-21T01:00:00.000Z",
    );
    writeRun(
      "failed-builder",
      "builder",
      600_000,
      599_000,
      undefined,
      "failed",
      "2026-04-21T02:00:00.000Z",
    );
    // Successful run with a recovered repair trip is not actionable on its
    // own — the self-healing worked, and the topRepairFailures aggregate
    // still surfaces the class when improver wakes on a genuine signal.
    writeRun(
      "repair-trip-builder",
      "builder",
      700_000,
      699_000,
      undefined,
      "success",
      "2026-04-21T03:00:00.000Z",
      ["critic-review"],
    );
    writeRun(
      "improver-failed",
      "improver",
      800_000,
      799_000,
      undefined,
      "failed",
      "2026-04-21T04:00:00.000Z",
    );

    const result = aggregateRunOutcomes(runsDir);
    expect(result.latestActionableRunAt).toBe("2026-04-21T02:00:00.000Z");
  });

  it("does not treat a duration-outlier successful run as actionable on its own", () => {
    // 24h evidence shows duration outliers track substantive successful work
    // (e.g. 75-min route migrations producing 525-line commits with full test
    // coverage), not waste. Triggering improver on outlier-only signals
    // consistently produced no-op runs that cost ~$2 each. Outliers are still
    // surfaced in the agent's view via the durationOutliers list so they can
    // be inspected when improver fires on a real failure.
    writeRun(
      "ok-1",
      "builder",
      500_000,
      499_000,
      undefined,
      "success",
      "2026-04-21T01:00:00.000Z",
    );
    writeRun(
      "ok-2",
      "builder",
      600_000,
      599_000,
      undefined,
      "success",
      "2026-04-21T02:00:00.000Z",
    );
    writeRun(
      "ok-3",
      "builder",
      700_000,
      699_000,
      undefined,
      "success",
      "2026-04-21T03:00:00.000Z",
    );
    writeRun(
      "outlier-success",
      "builder",
      2_500_000,
      2_499_000,
      undefined,
      "success",
      "2026-04-21T04:00:00.000Z",
    );

    const result = aggregateRunOutcomes(runsDir);
    expect(result.durationOutliers).toHaveLength(1);
    expect(result.durationOutliers[0].runId).toBe("outlier-success");
    expect(result.latestActionableRunAt).toBeNull();
  });

  it("returns null latestActionableRunAt when only successful runs with recovered repair trips exist", () => {
    writeRun(
      "repair-trip-1",
      "builder",
      500_000,
      499_000,
      undefined,
      "success",
      "2026-04-21T01:00:00.000Z",
      ["test"],
    );
    writeRun(
      "repair-trip-2",
      "builder",
      600_000,
      599_000,
      undefined,
      "success",
      "2026-04-21T02:00:00.000Z",
      ["critic-review"],
    );

    const result = aggregateRunOutcomes(runsDir);
    expect(result.latestActionableRunAt).toBeNull();
  });

  it("returns null latestActionableRunAt when only clean non-improver runs exist", () => {
    writeRun(
      "ok-1",
      "builder",
      500_000,
      499_000,
      undefined,
      "success",
      "2026-04-21T01:00:00.000Z",
    );
    writeRun(
      "ok-2",
      "explorer",
      600_000,
      599_000,
      undefined,
      "success",
      "2026-04-21T02:00:00.000Z",
    );

    const result = aggregateRunOutcomes(runsDir);
    expect(result.latestActionableRunAt).toBeNull();
  });

  function writeAgentStepTimeoutRun(
    id: string,
    workflow: string,
    stepId: string,
    completedAt: string,
    timeoutMs = 10_800_000,
  ): void {
    const runDir = join(runsDir, id);
    mkdirSync(runDir, { recursive: true });
    const metadata: WorkflowRunMetadata = {
      id,
      workflow,
      definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
      trigger: { event: "runtime.idle", payload: {} },
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      completedAt,
      status: "failed",
      durationMs: timeoutMs + 200,
      runDir: id,
      steps: [
        {
          id: stepId,
          type: "agent",
          status: "failed",
          startedAt: "2026-04-16T00:00:00.000Z",
          completedAt,
          durationMs: timeoutMs,
          error: `Step "${stepId}" timed out after ${timeoutMs}ms`,
        },
      ],
    };
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata));
  }

  it("does not advance latestActionableRunAt for an agent-step wall-clock timeout", () => {
    // 24h-around-2026-05-04 evidence: three improver, one decomposer, and one
    // builder run all hit the 3-hour `timeoutMs` rail with the same SDK-stall
    // shape ($0 cost, only an api_retry between meaningful frames). Treating
    // those as actionable autonomy evidence triggered the next improver, which
    // hit the same outage and burned another 3-hour slot.
    writeAgentStepTimeoutRun(
      "stalled-builder",
      "builder",
      "build",
      "2026-04-21T01:00:00.000Z",
    );
    writeAgentStepTimeoutRun(
      "stalled-decomposer",
      "decomposer",
      "decompose",
      "2026-04-21T02:00:00.000Z",
    );

    const result = aggregateRunOutcomes(runsDir);
    expect(result.latestActionableRunAt).toBeNull();
    expect(result.agentStepTimeouts7d.map((t) => t.runId)).toEqual([
      "stalled-decomposer",
      "stalled-builder",
    ]);
    expect(result.agentStepTimeouts7d[0]).toMatchObject({
      workflow: "decomposer",
      stepId: "decompose",
      completedAt: "2026-04-21T02:00:00.000Z",
    });
  });

  function writeAgentRuntimeFailureRun(
    id: string,
    workflow: string,
    stepId: string,
    completedAt: string,
    error: string,
  ): void {
    const runDir = join(runsDir, id);
    mkdirSync(runDir, { recursive: true });
    const metadata: WorkflowRunMetadata = {
      id,
      workflow,
      definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
      trigger: { event: "runtime.idle", payload: {} },
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      completedAt,
      status: "failed",
      durationMs: 600_000,
      runDir: id,
      steps: [
        {
          id: stepId,
          type: "agent",
          status: "failed",
          startedAt: "2026-04-16T00:00:00.000Z",
          completedAt,
          durationMs: 599_000,
          error,
        },
      ],
    };
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata));
  }

  it("does not advance latestActionableRunAt for classified provider transport failures", () => {
    writeAgentRuntimeFailureRun(
      "codex-compact-disconnect",
      "builder",
      "build",
      "2026-04-21T02:00:00.000Z",
      'Agent step "build" failed (codex_cli_error): Error running remote compact task: stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses/compact)',
    );
    writeAgentRuntimeFailureRun(
      "codex-websocket-disconnect",
      "builder",
      "build",
      "2026-04-21T03:00:00.000Z",
      'Repair agent for step "build" failed: Reconnecting... 2/5 (stream disconnected before completion: idle timeout sending websocket request)',
    );
    writeAgentRuntimeFailureRun(
      "codex-response-disconnect",
      "explorer",
      "explore",
      "2026-04-21T04:00:00.000Z",
      'Agent step "explore" failed (codex_cli_error): stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)',
    );

    const result = aggregateRunOutcomes(runsDir);
    expect(result.latestActionableRunAt).toBeNull();
  });

  it("still advances latestActionableRunAt for a non-timeout terminal failure even when an agent-step timeout coexists", () => {
    writeAgentStepTimeoutRun(
      "stalled-decomposer",
      "decomposer",
      "decompose",
      "2026-04-21T01:00:00.000Z",
    );
    writeRun(
      "real-failure",
      "builder",
      600_000,
      599_000,
      undefined,
      "failed",
      "2026-04-21T02:00:00.000Z",
    );

    const result = aggregateRunOutcomes(runsDir);
    expect(result.latestActionableRunAt).toBe("2026-04-21T02:00:00.000Z");
    expect(result.agentStepTimeouts7d).toHaveLength(1);
    expect(result.agentStepTimeouts7d[0].runId).toBe("stalled-decomposer");
  });

  it("does not treat numeric repair iteration summaries as repair trips", () => {
    const runDir = join(runsDir, "summary-only-builder");
    mkdirSync(runDir, { recursive: true });
    const metadata: WorkflowRunMetadata = {
      id: "summary-only-builder",
      workflow: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      trigger: { event: "runtime.idle", payload: {} },
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      completedAt: "2026-04-21T03:00:00.000Z",
      status: "success",
      durationMs: 500_000,
      runDir: "summary-only-builder",
      steps: [
        {
          id: "write-calibration-artifact",
          type: "code",
          status: "success",
          startedAt: "2026-04-21T03:00:00.000Z",
          completedAt: "2026-04-21T03:00:00.001Z",
          durationMs: 1,
          output: { repairIterations: 1 },
        },
      ],
    };
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata));

    const result = aggregateRunOutcomes(runsDir);
    expect(result.latestActionableRunAt).toBeNull();
    expect(result.topRepairFailures24h).toEqual([]);
  });
});
