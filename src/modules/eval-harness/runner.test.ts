import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveExecutableVerifierSandbox } from "./executable-verifier-sandbox.js";
import { loadFixture } from "./fixture.js";
import {
  cleanupFixtureWorkingDir,
  runFixture,
  type WorkflowExecutor,
} from "./runner.js";
import {
  alternativeAcceptingCheckerSource,
  alwaysFailCheckerSource,
  alwaysPassCheckerSource,
  shortcutAcceptingCheckerSource,
  strictCheckerSource,
  writeCalibratedShellFixture,
} from "./runner-calibration-test-support.js";
import {
  setupFixtureTree,
  TEST_EXECUTION_PROFILE,
} from "./runner-test-profiles.js";
import { writeFakeContainerBackend } from "./subprocess-executor-test-helpers.js";

const TEST_CONTAINER_DIR = mkdtempSync(join(tmpdir(), "kota-verifier-runtime-"));
const TEST_CONTAINER = join(TEST_CONTAINER_DIR, "fake-container.mjs");
writeFakeContainerBackend(TEST_CONTAINER);
const TEST_PREDICATE_CONTEXT = {
  executableVerifierSandbox: resolveExecutableVerifierSandbox(
    {
      kind: "container",
      executable: TEST_CONTAINER,
      image: "kota-eval:test",
      kotaBinaryPath: "/opt/kota/bin/kota.mjs",
    },
    {
      PATH: process.env.PATH,
      KOTA_FAKE_CONTAINER_USE_HOST_PATH: "1",
    },
  ),
};

afterAll(() => {
  rmSync(TEST_CONTAINER_DIR, { recursive: true, force: true });
});

describe("runFixture verifier calibration", () => {
  let fixturesRoot: string;
  let runsRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ fixturesRoot, runsRoot, cleanup } = setupFixtureTree());
  });

  afterEach(() => {
    cleanup();
  });

  it("passes when the executor satisfies every predicate", async () => {
    const fixture = loadFixture(fixturesRoot, "mini");
    const executor: WorkflowExecutor = {
      predicateContext: TEST_PREDICATE_CONTEXT,
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async ({ workingDir }) => {
        writeFileSync(join(workingDir, "output.txt"), "done");
        return { kind: "completed", durationMs: 5, runArtifactPath: null };
      },
    };
    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });
    expect(report.run.outcome).toBe("pass");
    expect(report.predicateResults.every((r) => r.passed)).toBe(true);
    expect(report.preRunExpectationResults.every((r) => r.passed)).toBe(true);

    const artifactPath = join(report.run.runArtifactPath, "fixture-run.json");
    const raw = JSON.parse(readFileSync(artifactPath, "utf-8"));
    expect(raw.fixtureId).toBe("mini");
    expect(raw.outcome).toBe("pass");
    expect(raw.rounds).toBeUndefined();
    expect(raw.executionProfile.status).toBe("verified");
    expect(raw.executionProfile.eligibilityReason).toBe("verified-profile");
    expect(raw.preRunExpectationResults).toHaveLength(2);
    expect(raw.objectiveMetrics).toEqual([]);
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("runs verifier calibration before workflow execution and writes the artifact", async () => {
    writeCalibratedShellFixture(
      fixturesRoot,
      "calibrated-shell",
      alternativeAcceptingCheckerSource,
      {
        acceptedAlternative: {
          id: "alternate-output",
          content: "also-ok\n",
        },
      },
    );
    const fixture = loadFixture(fixturesRoot, "calibrated-shell");
    let executorCalls = 0;
    const executor: WorkflowExecutor = {
      predicateContext: TEST_PREDICATE_CONTEXT,
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async ({ workingDir }) => {
        executorCalls++;
        writeFileSync(join(workingDir, "result.txt"), "ok\n");
        return { kind: "completed", durationMs: 5, runArtifactPath: null };
      },
    };

    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });

    expect(executorCalls).toBe(1);
    expect(report.run.outcome).toBe("pass");
    const calibration = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "verifier-calibration.json"), "utf-8"),
    );
    expect(calibration.passed).toBe(true);
    expect(calibration.cases.map((entry: { id: string; caseKind: string; passed: boolean }) => [
      entry.id,
      entry.caseKind,
      entry.passed,
    ])).toEqual([
      ["null", "null", true],
      ["golden", "golden", true],
      ["alternate-output", "accepted-alternative", true],
      ["adversarial", "adversarial", true],
    ]);
    const runArtifact = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "fixture-run.json"), "utf-8"),
    );
    expect(runArtifact.verifierCalibration.passed).toBe(true);
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("aborts before workflow execution when null calibration is a false positive", async () => {
    writeCalibratedShellFixture(
      fixturesRoot,
      "null-false-positive",
      alwaysPassCheckerSource,
    );
    const fixture = loadFixture(fixturesRoot, "null-false-positive");
    let executorCalls = 0;
    const executor: WorkflowExecutor = {
      predicateContext: TEST_PREDICATE_CONTEXT,
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => {
        executorCalls++;
        return { kind: "completed", durationMs: 5, runArtifactPath: null };
      },
    };

    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });

    expect(executorCalls).toBe(0);
    expect(report.run.outcome).toBe("configuration-error");
    expect(report.executionOutcome).toMatchObject({
      kind: "not-started",
      reason: "verifier-calibration-failed",
    });
    const calibration = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "verifier-calibration.json"), "utf-8"),
    );
    expect(calibration.cases.find((entry: { id: string }) => entry.id === "null")).toMatchObject({
      passed: false,
      scoringPassed: true,
    });
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("aborts before workflow execution when golden calibration is a false negative", async () => {
    writeCalibratedShellFixture(
      fixturesRoot,
      "golden-false-negative",
      alwaysFailCheckerSource,
    );
    const fixture = loadFixture(fixturesRoot, "golden-false-negative");
    const executor: WorkflowExecutor = {
      predicateContext: TEST_PREDICATE_CONTEXT,
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => ({ kind: "completed", durationMs: 5, runArtifactPath: null }),
    };

    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });

    expect(report.run.outcome).toBe("configuration-error");
    const calibration = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "verifier-calibration.json"), "utf-8"),
    );
    expect(calibration.cases.find((entry: { id: string }) => entry.id === "golden")).toMatchObject({
      passed: false,
      scoringPassed: false,
    });
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("aborts before workflow execution when an accepted alternative is a false negative", async () => {
    writeCalibratedShellFixture(
      fixturesRoot,
      "alternative-false-negative",
      strictCheckerSource,
      {
        acceptedAlternative: {
          id: "alternate-output",
          content: "also-ok\n",
        },
      },
    );
    const fixture = loadFixture(fixturesRoot, "alternative-false-negative");
    let executorCalls = 0;
    const executor: WorkflowExecutor = {
      predicateContext: TEST_PREDICATE_CONTEXT,
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => {
        executorCalls++;
        return { kind: "completed", durationMs: 5, runArtifactPath: null };
      },
    };

    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });

    expect(executorCalls).toBe(0);
    expect(report.run.outcome).toBe("configuration-error");
    expect(report.run.configurationError).toMatchObject({
      reason: "verifier-calibration-failed",
    });
    expect(report.run.configurationError?.detail).toContain("alternate-output");
    const calibration = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "verifier-calibration.json"), "utf-8"),
    );
    expect(
      calibration.cases.find((entry: { id: string }) => entry.id === "alternate-output"),
    ).toMatchObject({
      caseKind: "accepted-alternative",
      passed: false,
      scoringPassed: false,
    });
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("aborts before workflow execution when adversarial calibration is a false positive", async () => {
    writeCalibratedShellFixture(
      fixturesRoot,
      "adversarial-false-positive",
      shortcutAcceptingCheckerSource,
    );
    const fixture = loadFixture(fixturesRoot, "adversarial-false-positive");
    const executor: WorkflowExecutor = {
      predicateContext: TEST_PREDICATE_CONTEXT,
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => ({ kind: "completed", durationMs: 5, runArtifactPath: null }),
    };

    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });

    expect(report.run.outcome).toBe("configuration-error");
    const calibration = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "verifier-calibration.json"), "utf-8"),
    );
    expect(
      calibration.cases.find((entry: { id: string }) => entry.id === "adversarial"),
    ).toMatchObject({
      passed: false,
      scoringPassed: true,
    });
    cleanupFixtureWorkingDir(report.workingDir);
  });
});
