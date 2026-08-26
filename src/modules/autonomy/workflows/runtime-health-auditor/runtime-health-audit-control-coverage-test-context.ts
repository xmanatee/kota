import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  materializeAutonomyIssueProjection,
  readAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthReviewFromSignals,
  planAutonomyHealthReviewActions,
} from "../autonomy-health-reviewer/health-review.js";
import { collectRuntimeHealthAudit } from "./runtime-health-audit.js";

export const CONTROL_COVERAGE_NOW = "2026-06-19T12:00:00.000Z";

export function makeControlCoverageScopeRoot(): string {
  const workspaceRoot = join(
    tmpdir(),
    `kota-runtime-health-control-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(workspaceRoot, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], {
    cwd: workspaceRoot,
  });
  return workspaceRoot;
}

export function collectControlCoverageAudit(args: {
  workspaceRoot: string;
  options?: Parameters<typeof collectRuntimeHealthAudit>[0]["options"];
}) {
  return collectRuntimeHealthAudit({
    workspaceRoot: args.workspaceRoot,
    scopeRoot: args.workspaceRoot,
    stateDir: join(args.workspaceRoot, ".kota"),
    ...(args.options !== undefined ? { options: args.options } : {}),
  });
}

export function reviewAndApplyControlCoverage(
  workspaceRoot: string,
  audit: ReturnType<typeof collectRuntimeHealthAudit>,
) {
  const review = buildAutonomyHealthReviewFromSignals({
    signals: audit.signals,
    generatedAt: CONTROL_COVERAGE_NOW,
    sourceEventName: "autonomy.runtime-health.audit",
    reason: "test",
  });
  const currentProjection = readAutonomyIssueProjection(workspaceRoot);
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
  materializeAutonomyIssueProjection(workspaceRoot, finalized.projection);
  return finalized;
}

export function expectApprovalOwnerGatePattern(
  audit: ReturnType<typeof collectRuntimeHealthAudit>,
): void {
  expect(audit.patterns).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        dedupeKey:
          "control-coverage:approval-owner-gates:approval-or-owner-gate-unresolved",
        observationCount: 2,
      }),
    ]),
  );
}

export function expectNoObservableGateDiagnostics(
  audit: ReturnType<typeof collectRuntimeHealthAudit>,
): void {
  expect({
    evidenceGaps: audit.evidenceGaps,
    warningOrErrorPatterns: audit.patterns.filter((pattern) =>
      pattern.severity === "warning" || pattern.severity === "error"
    ),
  }).toEqual({ evidenceGaps: [], warningOrErrorPatterns: [] });
}
