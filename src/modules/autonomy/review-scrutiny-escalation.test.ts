import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { ReviewScrutinyReport } from "./review-scrutiny.js";
import {
  applyReviewScrutinyEscalation,
  buildReviewScrutinyEscalationReport,
  detectRecurringReviewScrutinyPatternsFromReport,
  proposeReviewScrutinyEscalation,
  type ReviewScrutinyEscalationConfig,
} from "./review-scrutiny-escalation.js";
import type {
  ReviewDecision,
  ReviewScrutinyRecord,
  ReviewSurface,
} from "./review-scrutiny-types.js";
import {
  REVIEW_SCRUTINY_SCHEMA_VERSION,
  SUPPORTED_REVIEW_SURFACES,
} from "./review-scrutiny-types.js";

const NOW = Date.parse("2026-06-23T12:00:00.000Z");
const CONFIG: ReviewScrutinyEscalationConfig = {
  nowMs: NOW,
  windowMs: 7 * 24 * 60 * 60 * 1000,
  minApprovalLikeDecisions: 3,
  minThinAcceptances: 3,
  minThinAcceptanceRatio: 0.75,
  cooldownMs: 24 * 60 * 60 * 1000,
};

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "review-scrutiny-escalation-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  }
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial", "--quiet"], {
    cwd: dir,
  });
  return dir;
}

function writeTask(projectDir: string, state: string, id: string): void {
  const updatedAt = new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
  writeFileSync(
    join(projectDir, "data", "tasks", state, `${id}.md`),
    [
      "---",
      `id: ${id}`,
      `title: ${id}`,
      `status: ${state}`,
      "priority: p2",
      "area: autonomy",
      "task_class: Meta",
      "summary: test",
      `created_at: ${updatedAt}`,
      `updated_at: ${updatedAt}`,
      "---",
      "",
      "## Problem",
      "",
      "Test task.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

function record(args: {
  index: number;
  thin: boolean;
  taskId?: string;
  surface?: ReviewSurface;
  workflow?: string;
  decision?: ReviewDecision;
}): ReviewScrutinyRecord {
  const generatedAt = new Date(NOW - (10 - args.index) * 60 * 1000).toISOString();
  return {
    schemaVersion: REVIEW_SCRUTINY_SCHEMA_VERSION,
    surface: args.surface ?? "critic",
    runId: `run-${args.workflow ?? "builder"}-${args.index}`,
    workflow: args.workflow ?? "builder",
    generatedAt,
    artifact: "critic-review.json",
    ...(args.taskId ? { taskId: args.taskId } : {}),
    decision: args.decision ?? "pass",
    signals: args.thin
      ? { issueCount: 0, warningCount: 0, reviewBodyLength: 12 }
      : { issueCount: 0, warningCount: 1, reviewBodyLength: 24 },
    absentMetrics: [
      "evidenceIdCount",
      "findingCount",
      "followUpTaskCount",
      "citedFileLineCount",
    ],
    thinAcceptance: args.thin,
  };
}

function report(records: ReviewScrutinyRecord[], unsupportedArtifacts = 0): ReviewScrutinyReport {
  return {
    totalReviews: records.length,
    approvalLikeDecisions: records.length,
    thinAcceptances: records.filter((entry) => entry.thinAcceptance).length,
    absentMetricCount: records.reduce(
      (total, entry) => total + entry.absentMetrics.length,
      0,
    ),
    unsupportedArtifacts,
    bySurface: SUPPORTED_REVIEW_SURFACES.map((surface) => ({
      surface,
      reviews: records.filter((entry) => entry.surface === surface).length,
      approvalLikeDecisions: records.filter((entry) => entry.surface === surface).length,
      thinAcceptances: records.filter(
        (entry) => entry.surface === surface && entry.thinAcceptance,
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

function detect(projectDir: string, records: ReviewScrutinyRecord[]) {
  return detectRecurringReviewScrutinyPatternsFromReport({
    report: report(records),
    tasks: listFullRepoTasks(projectDir),
    config: CONFIG,
  });
}

describe("review scrutiny escalation", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    writeTask(projectDir, "done", "task-reviewed");
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("keeps isolated thin approvals below the escalation gate", () => {
    const detection = detect(projectDir, [
      record({ index: 1, thin: true, taskId: "task-reviewed" }),
      record({ index: 2, thin: false, taskId: "task-reviewed" }),
    ]);

    expect(detection.patterns).toEqual([]);
    expect(detection.belowThreshold).toHaveLength(1);
    expect(detection.belowThreshold[0]?.belowThresholdReason).toContain(
      "below threshold",
    );
  });

  it("creates one evidence-backed repair task for a qualifying pattern", () => {
    const detection = detect(projectDir, [
      record({ index: 1, thin: true, taskId: "task-reviewed" }),
      record({ index: 2, thin: true, taskId: "task-reviewed" }),
      record({ index: 3, thin: true, taskId: "task-reviewed" }),
      record({ index: 4, thin: false, taskId: "task-reviewed" }),
    ]);
    expect(detection.patterns).toHaveLength(1);

    const pattern = detection.patterns[0]!;
    const proposal = proposeReviewScrutinyEscalation(projectDir, pattern, CONFIG);
    expect(proposal.action).toBe("create");
    const applied = applyReviewScrutinyEscalation(proposal, {
      projectDir,
      nowIso: new Date(NOW).toISOString(),
    });

    expect(applied.kind).toBe("created");
    const task = readFileSync(
      join(projectDir, "data", "tasks", "ready", `${pattern.taskId}.md`),
      "utf-8",
    );
    expect(task).toContain("status: ready");
    expect(task).toContain("task_class: Meta");
    expect(task).toContain("## Product / Safety Link");
    expect(task).toContain("run-builder-1");
    expect(task).toContain("critic-review.json");
  });

  it("noops on current evidence, suppresses churn inside cooldown, and refreshes after cooldown", () => {
    const first = detect(projectDir, [
      record({ index: 1, thin: true, taskId: "task-reviewed" }),
      record({ index: 2, thin: true, taskId: "task-reviewed" }),
      record({ index: 3, thin: true, taskId: "task-reviewed" }),
    ]).patterns[0]!;
    applyReviewScrutinyEscalation(
      proposeReviewScrutinyEscalation(projectDir, first, CONFIG),
      { projectDir, nowIso: new Date(NOW).toISOString() },
    );

    const current = proposeReviewScrutinyEscalation(projectDir, first, CONFIG);
    expect(current).toMatchObject({
      action: "noop",
      suppression: "already-current",
    });

    const changed = detect(projectDir, [
      record({ index: 1, thin: true, taskId: "task-reviewed" }),
      record({ index: 2, thin: true, taskId: "task-reviewed" }),
      record({ index: 3, thin: true, taskId: "task-reviewed" }),
      record({ index: 4, thin: true, taskId: "task-reviewed" }),
    ]).patterns[0]!;
    const cooldown = proposeReviewScrutinyEscalation(projectDir, changed, {
      ...CONFIG,
      nowMs: NOW + 60 * 60 * 1000,
    });
    expect(cooldown).toMatchObject({ action: "noop", suppression: "cooldown" });

    const refresh = proposeReviewScrutinyEscalation(projectDir, changed, {
      ...CONFIG,
      nowMs: NOW + 2 * 24 * 60 * 60 * 1000,
    });
    expect(refresh.action).toBe("refresh");
    const applied = applyReviewScrutinyEscalation(refresh, {
      projectDir,
      nowIso: new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(applied.kind).toBe("refreshed");
  });

  it("keeps absent metrics and unsupported artifacts as context instead of escalation proof", () => {
    const records = [
      record({ index: 1, thin: false, taskId: "task-reviewed" }),
      record({ index: 2, thin: false, taskId: "task-reviewed" }),
      record({ index: 3, thin: false, taskId: "task-reviewed" }),
    ];
    const detection = detectRecurringReviewScrutinyPatternsFromReport({
      report: report(records, 2),
      tasks: listFullRepoTasks(projectDir),
      config: CONFIG,
    });

    expect(detection.patterns).toEqual([]);
    expect(detection.belowThreshold).toEqual([]);
    expect(detection.unsupportedArtifacts).toBe(2);
  });

  it("surfaces active, cooldown-suppressed, and below-threshold report state", () => {
    const active = detect(projectDir, [
      record({ index: 1, thin: true, taskId: "task-reviewed" }),
      record({ index: 2, thin: true, taskId: "task-reviewed" }),
      record({ index: 3, thin: true, taskId: "task-reviewed" }),
    ]);
    const reportState = buildReviewScrutinyEscalationReport({
      projectDir,
      detection: active,
      config: CONFIG,
    });
    expect(reportState.activePatterns).toHaveLength(1);

    const proposal = proposeReviewScrutinyEscalation(
      projectDir,
      active.patterns[0]!,
      CONFIG,
    );
    applyReviewScrutinyEscalation(proposal, {
      projectDir,
      nowIso: new Date(NOW).toISOString(),
    });
    const changed = detect(projectDir, [
      record({ index: 1, thin: true, taskId: "task-reviewed" }),
      record({ index: 2, thin: true, taskId: "task-reviewed" }),
      record({ index: 3, thin: true, taskId: "task-reviewed" }),
      record({ index: 4, thin: true, taskId: "task-reviewed" }),
    ]);
    const cooldownState = buildReviewScrutinyEscalationReport({
      projectDir,
      detection: changed,
      config: { ...CONFIG, nowMs: NOW + 60 * 60 * 1000 },
    });
    expect(cooldownState.cooldownPatterns).toHaveLength(1);

    const below = detect(projectDir, [
      record({ index: 5, thin: true, taskId: "task-reviewed", workflow: "improver" }),
    ]);
    const belowState = buildReviewScrutinyEscalationReport({
      projectDir,
      detection: below,
      config: CONFIG,
    });
    expect(belowState.belowThresholdPatterns).toHaveLength(1);
  });
});
