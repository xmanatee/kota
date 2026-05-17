import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFixture } from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import {
  cleanupFixtureWorkingDir,
  runFixture,
  type WorkflowExecutor,
} from "./runner.js";

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
  gateEligible: true,
  eligibilityReason: "verified-profile",
  diagnostics: [],
};

function setupFixtureTree(): {
  fixturesRoot: string;
  runsRoot: string;
  cleanup: () => void;
} {
  const fixturesRoot = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixtures-"));
  const runsRoot = mkdtempSync(join(tmpdir(), "kota-eval-harness-runs-"));
  const fixtureDir = join(fixturesRoot, "mini");
  mkdirSync(join(fixtureDir, "initial"), { recursive: true });
  writeFileSync(
    join(fixtureDir, "fixture.json"),
    JSON.stringify({
      id: "mini",
      description: "minimal fixture",
      role: "builder",
      workflowName: "noop",
      budgetMs: 60_000,
      predicates: [{ kind: "file-exists", path: "output.txt" }],
      preRunExpectations: [
        { predicate: { kind: "file-exists", path: "output.txt" }, expected: "fail" },
        { predicate: { kind: "file-exists", path: "seed.txt" }, expected: "pass" },
      ],
      provenance: {
        kind: "smoke-fixture",
        justification: "minimal test fixture for runner unit tests",
      },
    }),
  );
  writeFileSync(join(fixtureDir, "initial", "seed.txt"), "seed");
  return {
    fixturesRoot,
    runsRoot,
    cleanup: () => {
      rmSync(fixturesRoot, { recursive: true, force: true });
      rmSync(runsRoot, { recursive: true, force: true });
    },
  };
}

describe("runFixture", () => {
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
    expect(raw.executionProfile.status).toBe("verified");
    expect(raw.executionProfile.eligibilityReason).toBe("verified-profile");
    expect(raw.preRunExpectationResults).toHaveLength(2);
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("reports fail when the executor completes but predicates miss", async () => {
    const fixture = loadFixture(fixturesRoot, "mini");
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => ({
        kind: "completed",
        durationMs: 5,
        runArtifactPath: null,
      }),
    };
    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });
    expect(report.run.outcome).toBe("fail");
    expect(report.preRunExpectationResults.every((r) => r.passed)).toBe(true);
    expect(report.predicateResults.some((r) => !r.passed)).toBe(true);
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("rejects an already-satisfied outcome predicate before invoking the executor", async () => {
    const fixture = loadFixture(fixturesRoot, "mini");
    writeFileSync(join(fixture.initialStateDir, "output.txt"), "already done");
    let executorCalls = 0;
    const executor: WorkflowExecutor = {
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
    expect(report.executionOutcome.kind).toBe("not-started");
    expect(report.predicateResults).toEqual([]);
    expect(report.preRunExpectationResults.some((r) => !r.passed)).toBe(true);
    const raw = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "fixture-run.json"), "utf-8"),
    );
    expect(raw.execution.reason).toBe("pre-run-sanity-failed");
    expect(raw.preRunExpectationResults.some((r: { passed: boolean }) => !r.passed)).toBe(
      true,
    );
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("reports timeout distinctly from fail when the executor reports timeout", async () => {
    const fixture = loadFixture(fixturesRoot, "mini");
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => ({
        kind: "timeout",
        durationMs: 60_001,
        runArtifactPath: null,
      }),
    };
    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });
    expect(report.run.outcome).toBe("timeout");
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("reports error when the executor throws and surfaces the message in the artifact", async () => {
    const fixture = loadFixture(fixturesRoot, "mini");
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => {
        throw new Error("boom");
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
    expect(report.run.outcome).toBe("error");
    const raw = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "fixture-run.json"), "utf-8"),
    );
    expect(raw.execution.message).toContain("boom");
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("installs declared external-call shims and forwards the shim dir to the executor", async () => {
    const shimFixturesRoot = mkdtempSync(
      join(tmpdir(), "kota-eval-harness-shims-"),
    );
    const shimRunsRoot = mkdtempSync(
      join(tmpdir(), "kota-eval-harness-shim-runs-"),
    );
    try {
      const fixtureDir = join(shimFixturesRoot, "shim-mini");
      mkdirSync(join(fixtureDir, "initial"), { recursive: true });
      writeFileSync(
        join(fixtureDir, "fixture.json"),
        JSON.stringify({
          id: "shim-mini",
          description: "minimal fixture exercising shim install",
          role: "pr-reviewer",
          workflowName: "noop",
          budgetMs: 60_000,
          predicates: [{ kind: "file-exists", path: "output.txt" }],
          preRunExpectations: [
            {
              predicate: { kind: "file-exists", path: "output.txt" },
              expected: "fail",
            },
          ],
          externalCallShims: ["gh"],
          provenance: {
            kind: "smoke-fixture",
            justification: "tests shim install wiring",
          },
        }),
      );
      const fixture = loadFixture(shimFixturesRoot, "shim-mini");
      let observedShimDir: string | undefined;
      const executor: WorkflowExecutor = {
        preflight: () => TEST_EXECUTION_PROFILE,
        execute: async ({ workingDir, externalCallShimDir }) => {
          observedShimDir = externalCallShimDir;
          writeFileSync(join(workingDir, "output.txt"), "done");
          return { kind: "completed", durationMs: 5, runArtifactPath: null };
        },
      };
      const report = await runFixture({
        fixture,
        executor,
        executionProfile: TEST_EXECUTION_PROFILE,
        runArtifactBaseDir: shimRunsRoot,
        runIndex: 0,
        repeatCount: 1,
      });
      expect(report.run.outcome).toBe("pass");
      expect(observedShimDir).toBeDefined();
      expect(observedShimDir!).toBe(join(report.workingDir, ".kota", "shims"));
      const ghShimPath = join(observedShimDir!, "gh");
      expect(readFileSync(ghShimPath, "utf-8").length).toBeGreaterThan(0);
      cleanupFixtureWorkingDir(report.workingDir);
    } finally {
      rmSync(shimFixturesRoot, { recursive: true, force: true });
      rmSync(shimRunsRoot, { recursive: true, force: true });
    }
  });

  it("copies initial state into the isolated working directory without mutating the fixture", async () => {
    const fixture = loadFixture(fixturesRoot, "mini");
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async ({ workingDir }) => {
        writeFileSync(join(workingDir, "output.txt"), "done");
        writeFileSync(join(workingDir, "seed.txt"), "tampered");
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
    const originalSeed = readFileSync(
      join(fixture.initialStateDir, "seed.txt"),
      "utf-8",
    );
    expect(originalSeed).toBe("seed");
    cleanupFixtureWorkingDir(report.workingDir);
  });
});
