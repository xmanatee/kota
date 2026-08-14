import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthReviewFromSignals,
} from "./health-review.js";
import type { collectRuntimeHealthAudit } from "./runtime-health-audit.js";

export const CONTROL_COVERAGE_NOW = "2026-06-19T12:00:00.000Z";

export function makeControlCoverageProjectDir(): string {
  const projectDir = join(
    tmpdir(),
    `kota-runtime-health-control-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(projectDir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], {
    cwd: projectDir,
    stdio: "ignore",
  });
  return projectDir;
}

export function reviewAndApplyControlCoverage(
  projectDir: string,
  audit: ReturnType<typeof collectRuntimeHealthAudit>,
) {
  const review = buildAutonomyHealthReviewFromSignals({
    signals: audit.signals,
    generatedAt: CONTROL_COVERAGE_NOW,
    sourceEventName: "autonomy.runtime-health.audit",
    reason: "test",
  });
  return applyAutonomyHealthReviewActions({ projectDir, review });
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
