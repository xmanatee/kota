import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  readAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { seedAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.test-helpers.js";
import {
  type AutonomyHealthSignalInput,
  normalizeHealthSignal,
} from "#modules/autonomy/health-signal.js";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthReviewFromSignals,
  planAutonomyHealthReviewActions,
} from "./health-review.js";

const NOW = "2026-06-17T12:30:00.000Z";
const SHARED_EVIDENCE = [
  {
    kind: "artifact" as const,
    ref: ".kota/runs/2026-07-24T19-45-52-295Z-builder-kubiqi/control-monitor-coverage.json",
    summary: "The builder run exposed two distinct control coverage gaps.",
  },
  {
    kind: "artifact" as const,
    ref: ".kota/runs/2026-07-24T20-36-32-226Z-security-review-yqlm1v/control-monitor-coverage.json",
    summary:
      "The security-review run exposed the same two distinct control coverage gaps.",
  },
];

function signal(
  dedupeKey: string,
  labels: string[],
  summary: string,
): ReturnType<typeof normalizeHealthSignal> {
  const input: AutonomyHealthSignalInput = {
    observation: "present",
    source: { kind: "workflow", id: "control-monitor-coverage" },
    severity: "warning",
    labels,
    summary,
    evidenceRefs: SHARED_EVIDENCE,
    actionability: "local-code",
    dedupeKey,
    observationCount: 2,
    createdAt: NOW,
  };
  return normalizeHealthSignal(input);
}

describe("autonomy health repair task deduplication", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-health-review-dedupe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: workspaceRoot });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function applyReview(review: ReturnType<typeof buildAutonomyHealthReviewFromSignals>) {
    const currentProjection = readAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota"));
    const plannedActions = planAutonomyHealthReviewActions({
      workspaceRoot,
      currentProjection,
      scopeRoot: workspaceRoot,
      review,
    });
    const finalized = applyAutonomyHealthReviewActions({
      currentProjection,
      scopeRoot: workspaceRoot,
      ownerQuestionQueue: new OwnerQuestionQueue(
        join(workspaceRoot, ".kota", "owner-questions"),
      ),
      review,
      plannedActions,
    });
    seedAutonomyIssueProjection(workspaceRoot, join(workspaceRoot, ".kota"), finalized.projection);
    return finalized;
  }

  it("tracks distinct shared-evidence groups without replay churn", () => {
    const review = buildAutonomyHealthReviewFromSignals({
      signals: [
        signal(
          "control-coverage:agent-step-stream:missing-agent-step-events",
          ["control-coverage", "agent-step-stream"],
          "Agent-step stream coverage is missing.",
        ),
        signal(
          "control-coverage:trajectory-diagnostics:missing-trajectory-diagnostics",
          ["control-coverage", "trajectory-diagnostics"],
          "Trajectory diagnostics coverage is missing.",
        ),
      ],
      generatedAt: NOW,
      sourceEventName: "autonomy.runtime-health.audit",
      reason: "test",
    });

    const first = applyReview(review);
    const replay = applyReview(review);

    expect(first.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey: "control-coverage:agent-step-stream:missing-agent-step-events",
      }),
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey:
          "control-coverage:trajectory-diagnostics:missing-trajectory-diagnostics",
      }),
    ]);
    expect(replay.applied).toEqual([]);
    expect(replay.issueTransitions.map((transition) => transition.kind)).toEqual([
      "replayed",
      "replayed",
    ]);
  });
  it("retains revision, clear and reopen chronology within one pending review", () => {
    const observations = ["present", "changed", "cleared", "present"] as const;
    const signals = observations.map((observation, index) => normalizeHealthSignal({
      ...signal("burst:revision", [index === 0 ? "original" : "revised"], "Attributable incident"),
      signalId: `revision-${index}`, observation, severity: "error",
      createdAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
      evidenceRefs: [{ kind: "artifact", ref: `.kota/runs/revision-${index}/evidence.json` }],
    }));
    const review = buildAutonomyHealthReviewFromSignals({
      signals, generatedAt: new Date(Date.parse(NOW) + 10_000).toISOString(),
      sourceEventName: "autonomy.health.signal", reason: "test",
    });
    const first = applyReview(review);
    expect(first.projection.issues).toHaveLength(1);
    const issue = first.projection.issues[0]!;
    expect(issue.history.map((entry) => entry.transition)).toEqual(["opened", "revised", "cleared", "reopened"]);
    expect(issue.history.map((entry) => entry.observedAt)).toEqual(signals.map((item) => item.createdAt));
    expect(issue.history.map((entry) => entry.evidenceRefs)).toEqual(signals.map((item) => item.evidenceRefs));
    expect(issue.semanticRevision).toBe(3);
    expect(issue.status).toBe("needs-decision");
    expect(applyReview(review).applied).toEqual([]);
  });

});
