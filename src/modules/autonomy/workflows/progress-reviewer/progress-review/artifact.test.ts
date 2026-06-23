import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeProgressReviewArtifact } from "./artifact.js";
import type { ProgressReviewArtifact } from "./types.js";

const GENERATED_AT = "2026-06-23T12:00:00.000Z";

function makeArtifact(): ProgressReviewArtifact {
  const scope = {
    kind: "directory" as const,
    scopeId: "scope-a",
    displayName: "Scope A",
    directoryRoot: "/repo",
  };
  const window = {
    startedAt: "2026-06-22T12:00:00.000Z",
    endedAt: GENERATED_AT,
    maxAgeMs: 86_400_000,
  };
  const counts = {
    runs: 0,
    tasks: 0,
    events: 0,
    artifacts: 0,
    git: 0,
    ownerQuestions: 0,
    approvals: 0,
    deadLetters: 0,
    evidence: 0,
    taskClasses: [],
  };
  return {
    generatedAt: GENERATED_AT,
    evidence: {
      generatedAt: GENERATED_AT,
      triggerKind: "manual",
      triggerEvent: "autonomy.progress-review.requested",
      scope,
      window,
      batch: null,
      scopes: [],
      runs: [],
      tasks: [],
      events: [],
      artifacts: [],
      git: [],
      ownerQuestions: [],
      approvals: [],
      deadLetterCounts: [],
      deadLetters: [],
      taskClassDistribution: [],
      operatorJourneyRisks: [],
      evidence: [],
      excluded: [],
    },
    reviewInput: {
      generatedAt: GENERATED_AT,
      triggerKind: "manual",
      triggerEvent: "autonomy.progress-review.requested",
      scope,
      window,
      batch: null,
      scopes: [],
      counts,
      deadLetterCounts: [],
      operatorJourneyRisks: [],
      evidence: [],
      excluded: [],
    },
    review: {
      verdict: "on-track",
      summary: "No issues found.",
      findings: {
        crossScope: { claims: [], followUpTasks: [] },
        localScope: { claims: [], followUpTasks: [] },
      },
      ownerQuestions: [],
    },
    actions: {
      createdTaskIds: [],
      ownerQuestionIds: [],
      applied: [],
      touchedTaskQueue: false,
    },
  };
}

describe("writeProgressReviewArtifact", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "progress-review-artifact-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes progress-review and review-scrutiny artifacts", () => {
    const artifactPath = writeProgressReviewArtifact(dir, makeArtifact(), {
      runId: "progress-run",
      workflow: "progress-reviewer",
    });

    expect(existsSync(artifactPath)).toBe(true);
    const scrutiny = JSON.parse(
      readFileSync(join(dir, "review-scrutiny.json"), "utf8"),
    );
    expect(scrutiny).toMatchObject({
      runId: "progress-run",
      workflow: "progress-reviewer",
      surface: "progress-reviewer",
      decision: "on-track",
      thinAcceptance: true,
      absentMetrics: ["warningCount", "citedFileLineCount"],
    });
  });
});
