import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFixture } from "./fixture.js";
import {
  cleanupFixtureWorkingDir,
  runFixture,
  type WorkflowExecutor,
} from "./runner.js";
import { writeMultiRoundFixture } from "./runner-multi-round-test-support.js";
import {
  setupFixtureTree,
  TEST_EXECUTION_PROFILE,
} from "./runner-test-profiles.js";

describe("runFixture multi-round", () => {
  let fixturesRoot: string;
  let runsRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ fixturesRoot, runsRoot, cleanup } = setupFixtureTree());
  });

  afterEach(() => {
    cleanup();
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
      "duplicated-implementation-chunk": 1,
    });
    const raw = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "fixture-run.json"), "utf-8"),
    );
    expect(raw.outcome).toBe("pass");
    expect(raw.codeHealthDiagnostics.baseline.fileCount).toBe(1);
    expect(raw.codeHealthDiagnostics.rounds[1].warnings.map((entry: { code: string }) => entry.code)).toEqual(
      expect.arrayContaining([
        "duplicated-implementation-chunk",
      ]),
    );
    cleanupFixtureWorkingDir(report.workingDir);
  });
});
