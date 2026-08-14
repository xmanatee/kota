import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AutonomyHealthSignalInput,
  normalizeHealthSignal,
} from "#modules/autonomy/health-signal.js";
import {
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthReviewFromSignals,
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
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-health-review-dedupe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

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

    const first = applyAutonomyHealthReviewActions({
      projectDir,
      review,
    });
    const replay = applyAutonomyHealthReviewActions({
      projectDir,
      review,
    });

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
});
