import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import { getCriticPromptHash } from "./critic.js";
import {
  buildReviewScrutinyAttentionDigest,
  buildReviewScrutinyEscalationReport,
  detectRecurringReviewScrutinyPatternsFromReport,
  type ReviewScrutinyEscalationConfig,
} from "./review-scrutiny-escalation.js";
import type {
  ReviewDecision,
  ReviewScrutinyRecord,
} from "./review-scrutiny-types.js";
import {
  REVIEW_SCRUTINY_SCHEMA_VERSION,
  SUPPORTED_REVIEW_SURFACES,
} from "./review-scrutiny-types.js";

const NOW = Date.parse("2026-06-24T00:00:00.000Z");
const CONFIG: ReviewScrutinyEscalationConfig = {
  nowMs: NOW,
  windowMs: 7 * 24 * 60 * 60 * 1000,
  minApprovalLikeDecisions: 3,
  minThinAcceptances: 3,
  minThinAcceptanceRatio: 0.75,
  cooldownMs: 24 * 60 * 60 * 1000,
};

function coreTask(id: string): RepoTaskFullRecord {
  return {
    id,
    title: id,
    state: "done",
    priority: "p2",
    area: "core",
    taskClass: "Unclassified",
    summary: "test",
    updatedAt: new Date(NOW).toISOString(),
    body: "",
    dependsOn: [],
    anchor: false,
  };
}

function report(records: ReviewScrutinyRecord[]) {
  return {
    totalReviews: records.length,
    approvalLikeDecisions: records.length,
    thinAcceptances: records.filter((record) => record.thinAcceptance).length,
    absentMetricCount: records.reduce(
      (total, record) => total + record.absentMetrics.length,
      0,
    ),
    unsupportedArtifacts: 0,
    bySurface: SUPPORTED_REVIEW_SURFACES.map((surface) => ({
      surface,
      reviews: records.filter((record) => record.surface === surface).length,
      approvalLikeDecisions: records.filter((record) => record.surface === surface)
        .length,
      thinAcceptances: records.filter(
        (record) => record.surface === surface && record.thinAcceptance,
      ).length,
      absentMetricCount: 0,
      unsupportedArtifacts: 0,
    })),
    thinAcceptanceRefs: [],
    absentMetricRefs: [],
    records,
    unsupported: [],
  };
}

function criticRecord(args: {
  index: number;
  taskId: string;
  thin: boolean;
  decision?: ReviewDecision;
}): ReviewScrutinyRecord {
  return {
    schemaVersion: REVIEW_SCRUTINY_SCHEMA_VERSION,
    surface: "critic",
    runId: `core-builder-${args.index}`,
    workflow: "builder",
    generatedAt: new Date(NOW - (10 - args.index) * 60 * 1000).toISOString(),
    artifact: "critic-review.json",
    reviewerPromptHash: getCriticPromptHash(),
    taskId: args.taskId,
    decision: args.decision ?? (args.thin ? "pass" : "pass_with_warnings"),
    signals: args.thin
      ? { issueCount: 0, warningCount: 0, reviewBodyLength: 18, citedFileLineCount: 0 }
      : { issueCount: 0, warningCount: 1, reviewBodyLength: 18, citedFileLineCount: 0 },
    absentMetrics: [
      "evidenceIdCount",
      "findingCount",
      "followUpTaskCount",
    ],
    thinAcceptance: args.thin,
  };
}

describe("review scrutiny core critic pattern", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "review-scrutiny-core-pattern-"));
    for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
      mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
    }
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("keeps fresh warning-backed builder core acceptances out of the escalation gate", () => {
    const task = coreTask("task-core-reviewed");
    const detection = detectRecurringReviewScrutinyPatternsFromReport({
      report: report([
        criticRecord({ index: 1, taskId: task.id, thin: false }),
        criticRecord({ index: 2, taskId: task.id, thin: false }),
        criticRecord({ index: 3, taskId: task.id, thin: false }),
      ]),
      tasks: [task],
      config: CONFIG,
    });

    expect(detection.patterns).toEqual([]);
    expect(detection.belowThreshold).toEqual([]);
  });

  it("keeps future core thin-acceptance escalations visible without cost fields", () => {
    const task = coreTask("task-core-thin-reviewed");
    const detection = detectRecurringReviewScrutinyPatternsFromReport({
      report: report([
        criticRecord({ index: 1, taskId: task.id, thin: true }),
        criticRecord({ index: 2, taskId: task.id, thin: true }),
        criticRecord({ index: 3, taskId: task.id, thin: true }),
      ]),
      tasks: [task],
      config: CONFIG,
    });

    expect(detection.patterns[0]?.fingerprint).toBe(
      "review-scrutiny:critic:builder:core:Unclassified",
    );

    const operatorReport = buildReviewScrutinyEscalationReport({
      projectDir,
      detection,
      config: CONFIG,
    });
    expect(operatorReport.activePatterns[0]).toMatchObject({
      patternFingerprint: "review-scrutiny:critic:builder:core:Unclassified",
      repairTaskId: detection.patterns[0]?.taskId,
    });

    const attention = buildReviewScrutinyAttentionDigest([
      {
        surface: "critic",
        workflow: "builder",
        taskId: detection.patterns[0]!.taskId,
        action: "skipped",
        thinAcceptances: 3,
        approvalLikeDecisions: 3,
        runIds: detection.patterns[0]!.runIds,
      },
    ]);
    const output = JSON.stringify({ operatorReport, attention });
    expect(output).toContain(detection.patterns[0]!.taskId);
    expect(output).not.toMatch(/cost|throughput/i);
  });
});
