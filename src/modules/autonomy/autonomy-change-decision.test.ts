import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AutonomyChangeDecisionArtifact,
  type AutonomyDecision,
  parseAutonomyChangeDecisionArtifact,
  readAutonomyChangeDecisionArtifact,
  writeAutonomyChangeDecisionArtifact,
} from "./autonomy-change-decision.js";

function decisionArtifact(
  decision: AutonomyDecision,
  overrides: Partial<AutonomyChangeDecisionArtifact> = {},
): AutonomyChangeDecisionArtifact {
  return {
    schemaVersion: 1,
    artifactType: "autonomy-change-decision",
    runId: "run-candidate",
    createdAt: "2026-07-07T00:00:00.000Z",
    taskIds: ["task-add-measured-autonomy-change-promotion-decisions"],
    affectedSurfaces: ["builder repair loop"],
    changeClasses: ["workflow", "repair-loop"],
    hypothesis:
      "A typed decision artifact will keep autonomy changes evidence-backed.",
    sourceRefs: ["task:task-add-measured-autonomy-change-promotion-decisions"],
    baselineRefs: [".kota/runs/run-baseline/eval-set-report.json"],
    candidateRefs: [".kota/runs/run-candidate/eval-set-report.json"],
    metricsCompared: [
      {
        name: "pass^k",
        baseline: "3/3",
        candidate: "3/3",
        unit: "fixtures",
        direction: "unchanged",
        qualitySignal: true,
      },
    ],
    rolloutMode: "fixture-only",
    decision,
    rationale: "Fixture evidence supports the stated rollout decision.",
    ownerSafetyExceptions: [],
    followUpTaskIds: [],
    ...overrides,
  };
}

describe("autonomy change decision artifacts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `kota-autonomy-change-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses and writes every decision outcome with baseline and candidate evidence", () => {
    const decisions: AutonomyDecision[] = [
      "promote",
      "hold",
      "rollback",
      "needs-more-data",
    ];

    for (const decision of decisions) {
      const path = join(tmpDir, `${decision}.json`);
      writeAutonomyChangeDecisionArtifact(path, decisionArtifact(decision));

      const read = readAutonomyChangeDecisionArtifact(path);
      expect(read).toMatchObject({
        kind: "valid",
        artifact: {
          decision,
          baselineRefs: [".kota/runs/run-baseline/eval-set-report.json"],
          candidateRefs: [".kota/runs/run-candidate/eval-set-report.json"],
        },
      });
    }
  });

  it("rejects malformed artifacts and missing required evidence fields", () => {
    expect(() =>
      parseAutonomyChangeDecisionArtifact({
        ...decisionArtifact("promote"),
        candidateRefs: [],
      }),
    ).toThrow("candidateRefs");
    expect(() =>
      parseAutonomyChangeDecisionArtifact({
        ...decisionArtifact("promote"),
        metricsCompared: [],
      }),
    ).toThrow("metricsCompared");
    expect(() =>
      parseAutonomyChangeDecisionArtifact({
        ...decisionArtifact("promote"),
        decision: "maybe",
      }),
    ).toThrow("decision");
  });

});
