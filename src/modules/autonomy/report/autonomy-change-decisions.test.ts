import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  AUTONOMY_CHANGE_DECISION_ARTIFACT,
  type AutonomyChangeDecisionArtifact,
  type AutonomyDecision,
  writeAutonomyChangeDecisionArtifact,
} from "../autonomy-change-decision.js";
import { buildAutonomyChangeDecisionReport } from "./autonomy-change-decisions.js";
import { renderReport } from "./render-test-helpers.js";
import { emptyAutonomyReportData } from "./report-test-fixtures.js";

function metadata(id: string): WorkflowRunMetadata {
  return {
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
    runDir: `.kota/runs/${id}`,
    status: "success",
    startedAt: "2026-07-07T00:00:00.000Z",
    completedAt: "2026-07-07T00:01:00.000Z",
    durationMs: 60_000,
    totalCostUsd: 1,
    steps: [],
    warnings: [],
  };
}

function artifact(
  runId: string,
  decision: AutonomyDecision,
  overrides: Partial<AutonomyChangeDecisionArtifact> = {},
): AutonomyChangeDecisionArtifact {
  return {
    schemaVersion: 1,
    artifactType: "autonomy-change-decision",
    runId,
    createdAt: "2026-07-07T00:00:00.000Z",
    taskIds: ["task-add-measured-autonomy-change-promotion-decisions"],
    affectedSurfaces: ["progress-reviewer prompt"],
    changeClasses: ["prompt", "reviewer"],
    hypothesis:
      "A stricter reviewer prompt should improve acceptance quality without hiding regressions.",
    sourceRefs: ["task:task-add-measured-autonomy-change-promotion-decisions"],
    baselineRefs: [".kota/runs/baseline/eval-set-report.json"],
    candidateRefs: [".kota/runs/candidate/eval-set-report.json"],
    metricsCompared: [
      {
        name: "pass^k",
        baseline: "3/3",
        candidate: "2/3",
        unit: "fixtures",
        direction: "regressed",
        qualitySignal: true,
      },
      {
        name: "cost",
        baseline: "$1.20",
        candidate: "$0.80",
        unit: "usd",
        direction: "improved",
        qualitySignal: false,
      },
    ],
    rolloutMode: "shadow",
    decision,
    rationale:
      "Candidate is cheaper and faster, but pass^k regressed, so quality blocks promotion.",
    ownerSafetyExceptions: [],
    followUpTaskIds: [],
    ...overrides,
  };
}

describe("autonomy change decision report", () => {
  let workspaceRoot: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-autonomy-change-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(workspaceRoot, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reads decisions with baseline, candidate, metrics, and rollout refs", () => {
    const runDir = join(runsDir, "candidate");
    mkdirSync(runDir, { recursive: true });
    writeAutonomyChangeDecisionArtifact(
      join(runDir, AUTONOMY_CHANGE_DECISION_ARTIFACT),
      artifact("candidate", "hold"),
    );

    const report = buildAutonomyChangeDecisionReport({
      runs: [metadata("candidate")],
      runsDir,
    });

    expect(report.totalDecisions).toBe(1);
    expect(report.decisions[0]).toMatchObject({
      runId: "candidate",
      decision: "hold",
      rolloutMode: "shadow",
      baselineRefs: [".kota/runs/baseline/eval-set-report.json"],
      candidateRefs: [".kota/runs/candidate/eval-set-report.json"],
    });
    expect(report.decisions[0]?.metricsCompared).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "pass^k",
          direction: "regressed",
          qualitySignal: true,
        }),
        expect.objectContaining({
          name: "cost",
          direction: "improved",
          qualitySignal: false,
        }),
      ]),
    );
  });

  it("keeps all decision outcomes visible", () => {
    const decisions: AutonomyDecision[] = [
      "promote",
      "hold",
      "rollback",
      "needs-more-data",
    ];
    for (const decision of decisions) {
      const runDir = join(runsDir, decision);
      mkdirSync(runDir, { recursive: true });
      writeAutonomyChangeDecisionArtifact(
        join(runDir, AUTONOMY_CHANGE_DECISION_ARTIFACT),
        artifact(decision, decision, {
          createdAt: `2026-07-07T00:0${decisions.indexOf(decision)}:00.000Z`,
        }),
      );
    }

    const report = buildAutonomyChangeDecisionReport({
      runs: decisions.map(metadata),
      runsDir,
    });

    expect(report.decisions.map((entry) => entry.decision).sort()).toEqual([
      "hold",
      "needs-more-data",
      "promote",
      "rollback",
    ]);
  });

  it("renders recent decisions without raw prompts or cost-only promotion bias", () => {
    const report = buildAutonomyChangeDecisionReport({
      runs: [metadata("candidate")],
      runsDir,
    });
    report.decisions.push({
      ...artifact("candidate", "hold"),
      createdAt: "2026-07-07T00:00:00.000Z",
    });
    report.totalDecisions = 1;

    const text = renderReport({
      ...emptyAutonomyReportData,
      autonomyChangeDecisions: report,
    });

    expect(text).toContain("Autonomy change decisions");
    expect(text).toContain("hold");
    expect(text).toContain("shadow");
    expect(text).toContain("pass^k: 3/3 -> 2/3 (regressed)");
    expect(text).toContain("cost: $1.20 -> $0.80 (improved)");
    expect(text).toContain("quality blocks promotion");
    expect(text).not.toContain("system prompt");
  });

  it("reports malformed artifacts without failing the report", () => {
    const runDir = join(runsDir, "bad");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, AUTONOMY_CHANGE_DECISION_ARTIFACT),
      "{\"schemaVersion\":1}",
      "utf-8",
    );

    const report = buildAutonomyChangeDecisionReport({
      runs: [metadata("bad")],
      runsDir,
    });

    expect(report.totalDecisions).toBe(0);
    expect(report.invalidArtifacts).toHaveLength(1);
    expect(report.invalidArtifacts[0]?.reason).toContain("artifactType");
  });
});
