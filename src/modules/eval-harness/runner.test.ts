import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFixture } from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import { ObjectiveMetricValidationError } from "./objective-metrics.js";
import { OFFLINE_CONTAINER_NETWORK_POLICY } from "./provider-egress.js";
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
  networkPolicy: OFFLINE_CONTAINER_NETWORK_POLICY,
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
      controlDecisions: ["act"],
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

function writeMultiRoundFixture(fixturesRoot: string, id = "multi-round-mini"): void {
  const fixtureDir = join(fixturesRoot, id);
  mkdirSync(join(fixtureDir, "initial", "state"), { recursive: true });
  mkdirSync(join(fixtureDir, "rounds"), { recursive: true });
  writeFileSync(join(fixtureDir, "initial", "state", "seed.txt"), "seed");
  writeFileSync(join(fixtureDir, "rounds", "round-2-task.md"), "round 2 task");
  writeFileSync(
    join(fixtureDir, "fixture.json"),
    JSON.stringify({
      id,
      description: "multi-round fixture",
      role: "builder",
      mode: "multi-round",
      rounds: [
        {
          id: "round-1",
          workflowName: "builder",
          budgetMs: 60_000,
          taskInput: { kind: "initial-state" },
          preRunExpectations: [
            { predicate: { kind: "file-exists", path: "state/round-1.txt" }, expected: "fail" },
          ],
          predicates: [{ kind: "file-exists", path: "state/round-1.txt" }],
        },
        {
          id: "round-2",
          workflowName: "builder",
          budgetMs: 70_000,
          taskInput: {
            kind: "copy-fixture-file",
            sourcePath: "rounds/round-2-task.md",
            targetPath: "data/tasks/ready/task-round-2.md",
          },
          preRunExpectations: [
            { predicate: { kind: "file-exists", path: "state/round-1.txt" }, expected: "pass" },
            { predicate: { kind: "file-exists", path: "data/tasks/ready/task-round-2.md" }, expected: "pass" },
            { predicate: { kind: "file-exists", path: "state/round-2.txt" }, expected: "fail" },
          ],
          predicates: [
            { kind: "file-exists", path: "state/round-1.txt" },
            { kind: "file-exists", path: "state/round-2.txt" },
          ],
        },
      ],
      aggregatePredicates: [
        { kind: "file-exists", path: "state/round-1.txt" },
        { kind: "file-exists", path: "state/round-2.txt" },
      ],
      controlDecisions: ["act"],
      provenance: {
        kind: "smoke-fixture",
        justification: "minimal test fixture for multi-round runner unit tests",
      },
    }),
  );
}

function writeCalibratedShellFixture(
  fixturesRoot: string,
  id: string,
  checkerSource: string,
): void {
  const fixtureDir = join(fixturesRoot, id);
  mkdirSync(join(fixtureDir, "initial", "scripts"), { recursive: true });
  mkdirSync(join(fixtureDir, "calibration", "golden"), { recursive: true });
  mkdirSync(join(fixtureDir, "calibration", "adversarial"), { recursive: true });
  writeFileSync(join(fixtureDir, "initial", "scripts", "check.mjs"), checkerSource);
  writeFileSync(join(fixtureDir, "calibration", "golden", "result.txt"), "ok\n");
  writeFileSync(
    join(fixtureDir, "calibration", "adversarial", "result.txt"),
    "shortcut\n",
  );
  writeFileSync(
    join(fixtureDir, "fixture.json"),
    JSON.stringify({
      id,
      description: "calibrated shell verifier fixture",
      role: "builder",
      workflowName: "noop",
      budgetMs: 60_000,
      predicates: [
        {
          kind: "shell-succeeds",
          command: "node scripts/check.mjs",
          timeoutMs: 10_000,
        },
      ],
      preRunExpectations: [
        {
          predicate: {
            kind: "shell-succeeds",
            command: "node scripts/check.mjs",
            timeoutMs: 10_000,
          },
          expected: "fail",
        },
      ],
      verifierCalibration: {
        null: {},
        golden: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/golden/result.txt",
              targetPath: "result.txt",
            },
          ],
        },
        adversarial: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/adversarial/result.txt",
              targetPath: "result.txt",
            },
          ],
        },
      },
      controlDecisions: ["act"],
      provenance: {
        kind: "smoke-fixture",
        justification: "tests verifier calibration without invoking an agent",
      },
    }),
  );
}

const strictCheckerSource = `import { readFileSync } from "node:fs";

let value = "";
try {
  value = readFileSync("result.txt", "utf8").trim();
} catch {}
process.exit(value === "ok" ? 0 : 1);
`;

const alwaysPassCheckerSource = `process.exit(0);
`;

const alwaysFailCheckerSource = `process.exit(1);
`;

const shortcutAcceptingCheckerSource = `import { readFileSync } from "node:fs";

let value = "";
try {
  value = readFileSync("result.txt", "utf8").trim();
} catch {}
process.exit(value === "ok" || value === "shortcut" ? 0 : 1);
`;

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
    expect(raw.rounds).toBeUndefined();
    expect(raw.executionProfile.status).toBe("verified");
    expect(raw.executionProfile.eligibilityReason).toBe("verified-profile");
    expect(raw.preRunExpectationResults).toHaveLength(2);
    expect(raw.objectiveMetrics).toEqual([]);
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("runs verifier calibration before workflow execution and writes the artifact", async () => {
    writeCalibratedShellFixture(fixturesRoot, "calibrated-shell", strictCheckerSource);
    const fixture = loadFixture(fixturesRoot, "calibrated-shell");
    let executorCalls = 0;
    const executor: WorkflowExecutor = {
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
    expect(calibration.cases.map((entry: { id: string; passed: boolean }) => [entry.id, entry.passed])).toEqual([
      ["null", true],
      ["golden", true],
      ["adversarial", true],
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

  it("aborts before workflow execution when adversarial calibration is a false positive", async () => {
    writeCalibratedShellFixture(
      fixturesRoot,
      "adversarial-false-positive",
      shortcutAcceptingCheckerSource,
    );
    const fixture = loadFixture(fixturesRoot, "adversarial-false-positive");
    const executor: WorkflowExecutor = {
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

  it("executes multi-round fixtures in order against one preserved workspace", async () => {
    writeMultiRoundFixture(fixturesRoot);
    const fixture = loadFixture(fixturesRoot, "multi-round-mini");
    const calls: Array<{ workflowName: string; workingDir: string; budgetMs: number }> = [];
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async ({ workflowName, workingDir, budgetMs }) => {
        calls.push({ workflowName, workingDir, budgetMs });
        if (calls.length === 1) {
          writeFileSync(join(workingDir, "state", "round-1.txt"), "done");
        } else {
          expect(readFileSync(join(workingDir, "state", "round-1.txt"), "utf-8")).toBe(
            "done",
          );
          expect(
            readFileSync(
              join(workingDir, "data", "tasks", "ready", "task-round-2.md"),
              "utf-8",
            ),
          ).toBe("round 2 task");
          writeFileSync(join(workingDir, "state", "round-2.txt"), "done");
        }
        return {
          kind: "completed",
          durationMs: 5,
          runArtifactPath: join(workingDir, `.kota/runs/round-${calls.length}`),
        };
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
    expect(calls).toEqual([
      { workflowName: "builder", workingDir: report.workingDir, budgetMs: 60_000 },
      { workflowName: "builder", workingDir: report.workingDir, budgetMs: 70_000 },
    ]);
    expect(report.run.rounds?.map((round) => round.outcome)).toEqual([
      "pass",
      "pass",
    ]);
    const raw = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "fixture-run.json"), "utf-8"),
    );
    expect(raw.fixture.mode).toBe("multi-round");
    expect(raw.rounds.map((round: { id: string }) => round.id)).toEqual([
      "round-1",
      "round-2",
    ]);
    expect(raw.aggregatePredicateResults.every((entry: { passed: boolean }) => entry.passed)).toBe(
      true,
    );
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("fails a multi-round fixture when a later completed round regresses prior behavior", async () => {
    writeMultiRoundFixture(fixturesRoot, "multi-round-regression");
    const fixture = loadFixture(fixturesRoot, "multi-round-regression");
    let call = 0;
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async ({ workingDir }) => {
        call++;
        if (call === 1) {
          writeFileSync(join(workingDir, "state", "round-1.txt"), "done");
        } else {
          rmSync(join(workingDir, "state", "round-1.txt"), { force: true });
          writeFileSync(join(workingDir, "state", "round-2.txt"), "done");
        }
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

    expect(report.run.outcome).toBe("fail");
    expect(report.executionOutcome.kind).toBe("completed");
    expect(report.run.rounds?.map((round) => round.outcome)).toEqual([
      "pass",
      "fail",
    ]);
    const raw = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "fixture-run.json"), "utf-8"),
    );
    expect(raw.rounds[1].predicateResults.some((entry: { passed: boolean }) => !entry.passed)).toBe(
      true,
    );
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("writes advisory code-health diagnostics for a passing multi-round fixture", async () => {
    const fixtureDir = join(fixturesRoot, "multi-round-code-health");
    mkdirSync(join(fixtureDir, "initial", "src"), { recursive: true });
    mkdirSync(join(fixtureDir, "initial", "state"), { recursive: true });
    writeFileSync(
      join(fixtureDir, "initial", "src", "feature.ts"),
      "export function base(): number {\n  return 1;\n}\n",
    );
    writeFileSync(
      join(fixtureDir, "fixture.json"),
      JSON.stringify({
        id: "multi-round-code-health",
        description: "multi-round fixture with advisory code health",
        role: "builder",
        mode: "multi-round",
        codeHealthDiagnostics: {
          sourceGlobs: ["src/**/*.ts"],
          thresholds: {
            minSourceGrowthBytes: 1,
            maxBaselineBytesGrowthRatio: 1.1,
            maxPreviousBytesGrowthRatio: 1.1,
            duplicateChunkLines: 3,
            duplicateChunkMinOccurrences: 2,
            maxLargestFileBytesShare: 1,
            maxLargestFunctionLines: 100,
          },
        },
        rounds: [
          {
            id: "round-1",
            workflowName: "builder",
            budgetMs: 60_000,
            taskInput: { kind: "initial-state" },
            preRunExpectations: [
              { predicate: { kind: "file-exists", path: "state/round-1.txt" }, expected: "fail" },
            ],
            predicates: [{ kind: "file-exists", path: "state/round-1.txt" }],
          },
          {
            id: "round-2",
            workflowName: "builder",
            budgetMs: 60_000,
            taskInput: { kind: "initial-state" },
            preRunExpectations: [
              { predicate: { kind: "file-exists", path: "state/round-1.txt" }, expected: "pass" },
              { predicate: { kind: "file-exists", path: "state/round-2.txt" }, expected: "fail" },
            ],
            predicates: [
              { kind: "file-exists", path: "state/round-1.txt" },
              { kind: "file-exists", path: "state/round-2.txt" },
            ],
          },
        ],
        aggregatePredicates: [
          { kind: "file-exists", path: "state/round-1.txt" },
          { kind: "file-exists", path: "state/round-2.txt" },
        ],
        controlDecisions: ["act"],
        provenance: {
          kind: "smoke-fixture",
          justification: "tests code-health diagnostic artifact wiring",
        },
      }),
    );
    const fixture = loadFixture(fixturesRoot, "multi-round-code-health");
    let call = 0;
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async ({ workingDir }) => {
        call++;
        if (call === 1) {
          writeFileSync(join(workingDir, "state", "round-1.txt"), "done");
        } else {
          writeFileSync(join(workingDir, "state", "round-2.txt"), "done");
          writeFileSync(
            join(workingDir, "src", "feature.ts"),
            [
              "export function base(): number {",
              "  return 1;",
              "}",
              "export function duplicateA(): number {",
              "  const value = 1;",
              "  return value;",
              "}",
              "export function duplicateB(): number {",
              "  const value = 1;",
              "  return value;",
              "}",
            ].join("\n"),
          );
        }
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
    expect(report.run.codeHealthDiagnostics?.rounds).toHaveLength(2);
    expect(report.run.codeHealthDiagnostics?.warningCounts).toMatchObject({
      "source-size-growth": 1,
      "duplicated-implementation-chunk": 1,
    });
    const raw = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "fixture-run.json"), "utf-8"),
    );
    expect(raw.outcome).toBe("pass");
    expect(raw.codeHealthDiagnostics.baseline.fileCount).toBe(1);
    expect(raw.codeHealthDiagnostics.rounds[1].warnings.map((entry: { code: string }) => entry.code)).toEqual(
      expect.arrayContaining([
        "source-size-growth",
        "duplicated-implementation-chunk",
      ]),
    );
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("initializes git for plain fixtures so git-change predicates can score", async () => {
    const fixtureDir = join(fixturesRoot, "git-mini");
    mkdirSync(join(fixtureDir, "initial"), { recursive: true });
    writeFileSync(
      join(fixtureDir, "fixture.json"),
      JSON.stringify({
        id: "git-mini",
        description: "minimal fixture with git change boundary",
        role: "builder",
        workflowName: "noop",
        budgetMs: 60_000,
        predicates: [
          { kind: "file-exists", path: "output.txt" },
          { kind: "git-changes-within", allowedPaths: ["output.txt"] },
        ],
        preRunExpectations: [
          { predicate: { kind: "file-exists", path: "output.txt" }, expected: "fail" },
        ],
        controlDecisions: ["act"],
        provenance: {
          kind: "smoke-fixture",
          justification: "minimal test fixture for runner git predicate plumbing",
        },
      }),
    );
    const fixture = loadFixture(fixturesRoot, "git-mini");
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

  it("evaluates declared objective metrics and writes them to the run artifact", async () => {
    const fixtureDir = join(fixturesRoot, "metric-mini");
    mkdirSync(join(fixtureDir, "initial"), { recursive: true });
    mkdirSync(join(fixtureDir, "calibration", "golden"), { recursive: true });
    mkdirSync(join(fixtureDir, "calibration", "adversarial"), {
      recursive: true,
    });
    writeFileSync(join(fixtureDir, "calibration", "golden", "metrics.txt"), "bytes=42");
    writeFileSync(
      join(fixtureDir, "calibration", "adversarial", "metrics.txt"),
      "bytes=99",
    );
    writeFileSync(
      join(fixtureDir, "fixture.json"),
      JSON.stringify({
        id: "metric-mini",
        description: "minimal fixture with objective metric",
        role: "builder",
        workflowName: "noop",
        budgetMs: 60_000,
        predicates: [{ kind: "file-exists", path: "output.txt" }],
        preRunExpectations: [
          { predicate: { kind: "file-exists", path: "output.txt" }, expected: "fail" },
        ],
        controlDecisions: ["act"],
        objectiveMetrics: [
          {
            name: "output_bytes",
            unit: "bytes",
            direction: "lower_is_better",
            source: {
              kind: "text-file",
              path: "metrics.txt",
              pattern: "bytes=(\\d+)",
            },
            comparisonBaseline: {
              value: 64,
              resourceProfile: TEST_PROFILE,
              executionProfile: {
                status: "verified",
                backendKind: "container",
                verification: "enforced",
                gateEligible: true,
              },
            },
          },
        ],
        verifierCalibration: {
          null: {},
          golden: {
            setup: [
              {
                kind: "copy-fixture-file",
                sourcePath: "calibration/golden/metrics.txt",
                targetPath: "metrics.txt",
              },
            ],
          },
          adversarial: {
            setup: [
              {
                kind: "copy-fixture-file",
                sourcePath: "calibration/adversarial/metrics.txt",
                targetPath: "metrics.txt",
              },
            ],
          },
        },
        provenance: {
          kind: "smoke-fixture",
          justification: "tests objective metric extraction",
        },
      }),
    );
    const fixture = loadFixture(fixturesRoot, "metric-mini");
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async ({ workingDir }) => {
        writeFileSync(join(workingDir, "output.txt"), "done");
        writeFileSync(join(workingDir, "metrics.txt"), "bytes=42");
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
    expect(report.objectiveMetrics).toHaveLength(1);
    expect(report.objectiveMetrics[0]).toMatchObject({
      fixtureId: "metric-mini",
      name: "output_bytes",
      unit: "bytes",
      direction: "lower_is_better",
      value: 42,
      comparison: {
        status: "compared",
        baselineValue: 64,
        currentValue: 42,
        delta: -22,
        improved: true,
      },
    });

    const raw = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "fixture-run.json"), "utf-8"),
    );
    expect(raw.objectiveMetrics[0].value).toBe(42);
    expect(raw.objectiveMetrics[0].comparison.status).toBe("compared");
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("fails loudly when objective metric source data is missing or nonnumeric", async () => {
    const cases = [
      { id: "missing-metric", fileContent: null, reason: "missing-source" },
      { id: "nonnumeric-metric", fileContent: "not-a-number", reason: "nonnumeric-value" },
    ] as const;

    for (const testCase of cases) {
      const fixtureDir = join(fixturesRoot, testCase.id);
      mkdirSync(join(fixtureDir, "initial"), { recursive: true });
      mkdirSync(join(fixtureDir, "calibration", "golden"), { recursive: true });
      mkdirSync(join(fixtureDir, "calibration", "adversarial"), {
        recursive: true,
      });
      writeFileSync(join(fixtureDir, "calibration", "golden", "metric.txt"), "2");
      writeFileSync(
        join(fixtureDir, "calibration", "adversarial", "metric.txt"),
        "1",
      );
      writeFileSync(
        join(fixtureDir, "fixture.json"),
        JSON.stringify({
          id: testCase.id,
          description: "objective metric validation",
          role: "builder",
          workflowName: "noop",
          budgetMs: 60_000,
          predicates: [{ kind: "file-exists", path: "output.txt" }],
          preRunExpectations: [
            { predicate: { kind: "file-exists", path: "output.txt" }, expected: "fail" },
          ],
          controlDecisions: ["act"],
          objectiveMetrics: [
            {
              name: "quality_score",
              unit: "score",
              direction: "higher_is_better",
              source: { kind: "text-file", path: "metric.txt" },
            },
          ],
          verifierCalibration: {
            null: {},
            golden: {
              setup: [
                {
                  kind: "copy-fixture-file",
                  sourcePath: "calibration/golden/metric.txt",
                  targetPath: "metric.txt",
                },
              ],
            },
            adversarial: {
              setup: [
                {
                  kind: "copy-fixture-file",
                  sourcePath: "calibration/adversarial/metric.txt",
                  targetPath: "metric.txt",
                },
              ],
            },
          },
          provenance: {
            kind: "smoke-fixture",
            justification: "tests objective metric validation failures",
          },
        }),
      );
      const fixture = loadFixture(fixturesRoot, testCase.id);
      const executor: WorkflowExecutor = {
        preflight: () => TEST_EXECUTION_PROFILE,
        execute: async ({ workingDir }) => {
          writeFileSync(join(workingDir, "output.txt"), "done");
          if (testCase.fileContent !== null) {
            writeFileSync(join(workingDir, "metric.txt"), testCase.fileContent);
          }
          return { kind: "completed", durationMs: 5, runArtifactPath: null };
        },
      };

      let caught: unknown;
      try {
        await runFixture({
          fixture,
          executor,
          executionProfile: TEST_EXECUTION_PROFILE,
          runArtifactBaseDir: runsRoot,
          runIndex: 0,
          repeatCount: 1,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ObjectiveMetricValidationError);
      expect((caught as ObjectiveMetricValidationError).reason).toBe(
        testCase.reason,
      );
    }
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
          controlDecisions: ["act"],
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
