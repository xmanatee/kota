import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTONOMY_CHANGE_DECISION_ARTIFACT,
  type AutonomyChangeDecisionArtifact,
  type AutonomyDecision,
  checkAutonomyChangeDecisionForRun,
  detectMaterialAutonomyChangeRequirement,
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

function diffFor(file: string, addedLines: readonly string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    "index 0000001..0000002 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,1 +1,${Math.max(addedLines.length, 1)} @@`,
    ...addedLines.map((line) => `+${line}`),
  ].join("\n");
}

function initRepo(dir: string): void {
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -q -m "init"', { cwd: dir });
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

  it("detects material autonomy prompt, workflow, reviewer, and harness changes", () => {
    const requirement = detectMaterialAutonomyChangeRequirement(
      [
        diffFor("src/modules/autonomy/workflows/builder/prompt.md", [
          "Tighten critic prompt evidence handling.",
        ]),
        diffFor("src/modules/autonomy/workflows/builder/workflow.ts", [
          "const repairLoop = { maxRepairAttempts: undefined };",
        ]),
        diffFor("src/modules/autonomy/review-scrutiny-collect.ts", [
          "const reviewerVerdict = artifact.verdict;",
        ]),
        diffFor("src/core/agent-harness/executor.ts", [
          "export const harnessModel = model;",
        ]),
      ].join("\n"),
    );

    expect(requirement.required).toBe(true);
    expect(requirement.changeClasses).toEqual([
      "workflow",
      "prompt",
      "harness",
      "reviewer",
      "critic-gate",
      "repair-loop",
    ]);
    expect(requirement.changedFiles).toContain(
      "src/modules/autonomy/workflows/builder/prompt.md",
    );
  });

  it("requires a valid decision artifact for staged material autonomy changes", () => {
    initRepo(tmpDir);
    const workflowDir = join(
      tmpDir,
      "src",
      "modules",
      "autonomy",
      "workflows",
      "builder",
    );
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(
      join(workflowDir, "workflow.ts"),
      "export const workflow = { repairLoop: true };\n",
    );
    execSync("git add src/modules/autonomy/workflows/builder/workflow.ts", {
      cwd: tmpDir,
    });
    const runDir = join(tmpDir, ".kota", "runs", "test-run");
    mkdirSync(runDir, { recursive: true });

    expect(() => checkAutonomyChangeDecisionForRun(tmpDir, runDir)).toThrow(
      AUTONOMY_CHANGE_DECISION_ARTIFACT,
    );

    writeAutonomyChangeDecisionArtifact(
      join(runDir, AUTONOMY_CHANGE_DECISION_ARTIFACT),
      decisionArtifact("needs-more-data"),
    );

    expect(checkAutonomyChangeDecisionForRun(tmpDir, runDir)).toContain(
      "covers 1 material autonomy file",
    );
    expect(
      JSON.parse(
        readFileSync(join(runDir, AUTONOMY_CHANGE_DECISION_ARTIFACT), "utf-8"),
      ),
    ).toMatchObject({ decision: "needs-more-data" });
  });
});
