import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFixture } from "./fixture.js";
import { ObjectiveMetricValidationError } from "./objective-metrics.js";
import {
  cleanupFixtureWorkingDir,
  runFixture,
  type WorkflowExecutor,
} from "./runner.js";
import {
  setupFixtureTree,
  TEST_EXECUTION_PROFILE,
  TEST_PROFILE,
} from "./runner-test-profiles.js";

describe("runFixture objective metrics", () => {
  let fixturesRoot: string;
  let runsRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ fixturesRoot, runsRoot, cleanup } = setupFixtureTree());
  });

  afterEach(() => {
    cleanup();
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

      const failedReport = await runFixture({
        fixture,
        executor: {
          preflight: () => TEST_EXECUTION_PROFILE,
          execute: async ({ workingDir }) => {
            if (testCase.fileContent !== null) {
              writeFileSync(join(workingDir, "metric.txt"), testCase.fileContent);
            }
            return { kind: "completed", durationMs: 5, runArtifactPath: null };
          },
        },
        executionProfile: TEST_EXECUTION_PROFILE,
        runArtifactBaseDir: runsRoot,
        runIndex: 1,
        repeatCount: 2,
      });
      expect(failedReport.run.outcome).toBe("fail");
      expect(failedReport.objectiveMetrics).toEqual([]);
      expect(failedReport.objectiveMetricErrors).toEqual([
        expect.objectContaining({
          fixtureId: testCase.id,
          metricName: "quality_score",
          reason: testCase.reason,
        }),
      ]);
      const failedArtifact = JSON.parse(
        readFileSync(
          join(failedReport.run.runArtifactPath, "fixture-run.json"),
          "utf-8",
        ),
      );
      expect(failedArtifact.objectiveMetricErrors).toEqual(
        failedReport.objectiveMetricErrors,
      );
      cleanupFixtureWorkingDir(failedReport.workingDir);
    }
  });
});
