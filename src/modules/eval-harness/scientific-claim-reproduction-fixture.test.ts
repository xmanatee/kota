import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSingleWorkflowFixtureSpec, loadFixture } from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import { evaluatePredicate } from "./predicates.js";
import { OFFLINE_CONTAINER_NETWORK_POLICY } from "./provider-egress.js";
import {
  cleanupFixtureWorkingDir,
  runFixture,
  type WorkflowExecutionOutcome,
  type WorkflowExecutor,
} from "./runner.js";

const FIXTURE_ID = "builder-scientific-claim-reproduction";
const FIXTURES_ROOT = join(process.cwd(), "src/modules/eval-harness/fixtures");

const TEST_PROFILE: ResourceProfile = {
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4000,
  memoryKillThresholdMB: 4000,
  hostClass: "test",
};

const TEST_EXECUTION_PROFILE: ExecutionProfilePreflightResult = {
  status: "verified",
  backendKind: "container",
  requestedProfile: TEST_PROFILE,
  observedOrEnforcedProfile: TEST_PROFILE,
  verification: "enforced",
  networkPolicy: OFFLINE_CONTAINER_NETWORK_POLICY,
  gateEligible: true,
  eligibilityReason: "verified-profile",
  diagnostics: [],
};

const CALIBRATION_ROOT = join(FIXTURES_ROOT, FIXTURE_ID, "calibration");
const passingAnalyzer = readFileSync(join(CALIBRATION_ROOT, "analyze-claim.mjs"), "utf8");
const shortcutAnalyzer = readFileSync(
  join(CALIBRATION_ROOT, "adversarial", "hardcoded-analyze-claim.mjs"),
  "utf8",
);

describe("builder scientific claim reproduction fixture", () => {
  it("runs as a live-builder fixture without replay recordings", async () => {
    const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
    expect(fixture.agentStepRecordings).toHaveLength(0);

    let replayRecordingsRoot: string | undefined;
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async (request): Promise<WorkflowExecutionOutcome> => {
        replayRecordingsRoot = request.replayRecordingsRoot;
        writeFileSync(
          join(request.workingDir, "scripts/analyze-claim.mjs"),
          passingAnalyzer,
        );
        const result = spawnSync(
          process.execPath,
          [
            "scripts/analyze-claim.mjs",
            "--data",
            "data/claims/lx12-biomass.csv",
            "--output",
            "claim-result.json",
          ],
          { cwd: request.workingDir, encoding: "utf8" },
        );
        expect(result.status).toBe(0);
        const holdoutResult = spawnSync(
          process.execPath,
          [
            "scripts/analyze-claim.mjs",
            "--data",
            "data/claims/lx12-holdout.csv",
            "--output",
            "claim-holdout-result.json",
          ],
          { cwd: request.workingDir, encoding: "utf8" },
        );
        expect(holdoutResult.status).toBe(0);
        return { kind: "completed", durationMs: 5, runArtifactPath: null };
      },
    };
    const runArtifactBaseDir = mkdtempSync(
      join(tmpdir(), "kota-scientific-claim-live-fixture-"),
    );
    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir,
      runIndex: 0,
      repeatCount: 1,
    });
    try {
      expect(replayRecordingsRoot).toBeUndefined();
      expect(
        report.predicateResults.find(
          (result) => result.predicate.kind === "lx12-scientific-claim-result",
        )?.passed,
      ).toBe(true);
    } finally {
      cleanupFixtureWorkingDir(report.workingDir);
      rmSync(runArtifactBaseDir, { recursive: true, force: true });
    }
  });

  it("accepts a passing analyzer when the temp directory uses a symlinked path", () => {
    const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
    if (!isSingleWorkflowFixtureSpec(fixture.spec)) {
      throw new Error(`${FIXTURE_ID} must stay a single-workflow fixture`);
    }
    const claimPredicate = fixture.spec.predicates[0];
    const workingDir = mkdtempSync(join(tmpdir(), "kota-scientific-symlink-"));
    const tempRoot = mkdtempSync(join(tmpdir(), "kota-scientific-temp-root-"));
    const realTempDir = join(tempRoot, "real");
    const linkedTempDir = join(tempRoot, "linked");
    const originalTmpdir = process.env.TMPDIR;
    try {
      cpSync(fixture.initialStateDir, workingDir, { recursive: true });
      writeFileSync(join(workingDir, "scripts/analyze-claim.mjs"), passingAnalyzer);
      for (const [dataPath, outputPath] of [
        ["data/claims/lx12-biomass.csv", "claim-result.json"],
        ["data/claims/lx12-holdout.csv", "claim-holdout-result.json"],
      ] as const) {
        const result = spawnSync(
          process.execPath,
          ["scripts/analyze-claim.mjs", "--data", dataPath, "--output", outputPath],
          { cwd: workingDir, encoding: "utf8" },
        );
        expect(result.status).toBe(0);
      }
      mkdirSync(realTempDir);
      symlinkSync(realTempDir, linkedTempDir, "dir");
      process.env.TMPDIR = linkedTempDir;

      const result = evaluatePredicate(workingDir, claimPredicate);
      expect(result.passed).toBe(true);
    } finally {
      if (originalTmpdir === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = originalTmpdir;
      }
      rmSync(workingDir, { recursive: true, force: true });
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects hardcoded answers for both known data sets", () => {
    const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
    if (!isSingleWorkflowFixtureSpec(fixture.spec)) {
      throw new Error(`${FIXTURE_ID} must stay a single-workflow fixture`);
    }
    const claimPredicate = fixture.spec.predicates[0];
    const workingDir = mkdtempSync(join(tmpdir(), "kota-scientific-shortcut-"));
    try {
      cpSync(fixture.initialStateDir, workingDir, { recursive: true });
      writeFileSync(
        join(workingDir, "scripts/analyze-claim.mjs"),
        shortcutAnalyzer,
      );
      const seed = spawnSync(
        process.execPath,
        [
          "scripts/analyze-claim.mjs",
          "--data",
          "data/claims/lx12-biomass.csv",
          "--output",
          "claim-result.json",
        ],
        { cwd: workingDir, encoding: "utf8" },
      );
      expect(seed.status).toBe(0);
      const holdoutSeed = spawnSync(
        process.execPath,
        [
          "scripts/analyze-claim.mjs",
          "--data",
          "data/claims/lx12-holdout.csv",
          "--output",
          "claim-holdout-result.json",
        ],
        { cwd: workingDir, encoding: "utf8" },
      );
      expect(holdoutSeed.status).toBe(0);

      const result = spawnSync(
        process.execPath,
        ["scripts/check-claim.mjs", "--max-error-pct", "0.000001"],
        { cwd: workingDir, encoding: "utf8" },
      );
      expect(result.status).toBe(0);

      const predicateResult = evaluatePredicate(workingDir, claimPredicate);
      expect(predicateResult.passed).toBe(false);
      expect(predicateResult.detail).toContain("verifier artifact");
      expect(predicateResult.detail).toContain("No hardcoded answer");
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });

  it("rejects prewritten expected artifacts when the analyzer still computes the wrong procedure", () => {
    const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
    if (!isSingleWorkflowFixtureSpec(fixture.spec)) {
      throw new Error(`${FIXTURE_ID} must stay a single-workflow fixture`);
    }
    const claimPredicate = fixture.spec.predicates[0];
    expect(claimPredicate.kind).toBe("lx12-scientific-claim-result");
    const workingDir = mkdtempSync(join(tmpdir(), "kota-scientific-boundary-"));
    try {
      cpSync(fixture.initialStateDir, workingDir, { recursive: true });
      writeFileSync(
        join(workingDir, "scripts/analyze-claim.mjs"),
        passingAnalyzer,
      );
      for (const [dataPath, outputPath] of [
        ["data/claims/lx12-biomass.csv", "claim-result.json"],
        ["data/claims/lx12-holdout.csv", "claim-holdout-result.json"],
      ] as const) {
        const result = spawnSync(
          process.execPath,
          ["scripts/analyze-claim.mjs", "--data", dataPath, "--output", outputPath],
          { cwd: workingDir, encoding: "utf8" },
        );
        expect(result.status).toBe(0);
      }

      const checker = spawnSync(
        process.execPath,
        ["scripts/check-claim.mjs", "--max-error-pct", "0.000001"],
        { cwd: workingDir, encoding: "utf8" },
      );
      expect(checker.status).toBe(0);
      writeFileSync(
        join(workingDir, "scripts/analyze-claim.mjs"),
        readFileSync(
          join(fixture.initialStateDir, "scripts/analyze-claim.mjs"),
          "utf8",
        ),
      );

      const result = evaluatePredicate(workingDir, claimPredicate);
      expect(result.passed).toBe(false);
      expect(result.detail).toContain("main command artifact");
      expect(result.detail).toContain("metric.name");
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });

  it("executes the analyzer with host filesystem access denied", () => {
    const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
    if (!isSingleWorkflowFixtureSpec(fixture.spec)) {
      throw new Error(`${FIXTURE_ID} must stay a single-workflow fixture`);
    }
    const claimPredicate = fixture.spec.predicates[0];
    const workingDir = mkdtempSync(join(tmpdir(), "kota-scientific-permission-"));
    try {
      cpSync(fixture.initialStateDir, workingDir, { recursive: true });
      writeFileSync(join(workingDir, "scripts/analyze-claim.mjs"), passingAnalyzer);
      for (const [dataPath, outputPath] of [
        ["data/claims/lx12-biomass.csv", "claim-result.json"],
        ["data/claims/lx12-holdout.csv", "claim-holdout-result.json"],
      ] as const) {
        const result = spawnSync(
          process.execPath,
          ["scripts/analyze-claim.mjs", "--data", dataPath, "--output", outputPath],
          { cwd: workingDir, encoding: "utf8" },
        );
        expect(result.status).toBe(0);
      }
      writeFileSync(
        join(workingDir, "scripts/analyze-claim.mjs"),
        'import { readFileSync } from "node:fs"; readFileSync("/etc/hosts");\n',
      );

      const result = evaluatePredicate(workingDir, claimPredicate);
      expect(result.passed).toBe(false);
      expect(result.detail).toContain("ERR_ACCESS_DENIED");
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });
});
