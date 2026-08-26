import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runEvalSet } from "./eval-set.js";
import {
  EXECUTION_PROFILE,
  PROFILE,
  seedFixture,
} from "./eval-set-test-support.js";
import { loadAllFixtures } from "./fixture.js";
import type { WorkflowExecutor } from "./runner.js";

describe("runEvalSet metrics", () => {
  let fixturesRoot: string;
  let runsRoot: string;

  beforeEach(() => {
    fixturesRoot = mkdtempSync(join(tmpdir(), "kota-eval-harness-set-fx-"));
    runsRoot = mkdtempSync(join(tmpdir(), "kota-eval-harness-set-runs-"));
  });

  afterEach(() => {
    rmSync(fixturesRoot, { recursive: true, force: true });
    rmSync(runsRoot, { recursive: true, force: true });
  });

  it("writes objective metric aggregates without changing pass/fail aggregation", async () => {
    seedFixture(
      fixturesRoot,
      "alpha",
      { kind: "file-exists", path: "alpha.txt" },
      [
        {
          name: "output_bytes",
          unit: "bytes",
          direction: "lower_is_better",
          source: { kind: "text-file", path: "metric.txt" },
          comparisonBaseline: {
            value: 20,
            resourceProfile: PROFILE,
            executionProfile: {
              status: "verified",
              backendKind: "container",
              verification: "enforced",
              gateEligible: true,
            },
          },
        },
      ],
    );
    const fixtures = loadAllFixtures(fixturesRoot);
    let call = 0;
    const executor: WorkflowExecutor = {
      preflight: () => EXECUTION_PROFILE,
      execute: async ({ workingDir }) => {
        writeFileSync(join(workingDir, "alpha.txt"), "ok");
        writeFileSync(join(workingDir, "metric.txt"), String(call === 0 ? 12 : 10));
        call++;
        return { kind: "completed", durationMs: 10, runArtifactPath: null };
      },
    };

    const report = await runEvalSet({
      projectDir: fixturesRoot,
      fixtures,
      executor,
      requestedProfile: PROFILE,
      runArtifactBaseDir: runsRoot,
      repeatCount: 2,
    });

    expect(report.aggregate.passAtK).toBe(1);
    expect(report.aggregate.passHatK).toBe(1);
    expect(report.objectiveMetrics).toHaveLength(1);
    expect(report.objectiveMetrics[0]).toMatchObject({
      fixtureId: "alpha",
      name: "output_bytes",
      unit: "bytes",
      sampleCount: 2,
      values: [12, 10],
      min: 10,
      max: 12,
      mean: 11,
      resourceProfileComparison: { status: "comparable" },
      executionProfileComparison: { status: "comparable" },
      comparison: {
        status: "compared",
        baselineValue: 20,
        currentValue: 11,
        delta: -9,
        improved: true,
      },
    });

    const raw = JSON.parse(
      readFileSync(join(runsRoot, "eval-set-report.json"), "utf-8"),
    );
    expect(raw.objectiveMetrics[0].mean).toBe(11);
    expect(raw.runs[0].objectiveMetrics[0].value).toBe(12);
  });

  it("does not treat source growth as a code-health warning", async () => {
    const dir = join(fixturesRoot, "code-health");
    mkdirSync(join(dir, "initial", "src"), { recursive: true });
    mkdirSync(join(dir, "initial", "state"), { recursive: true });
    writeFileSync(join(dir, "initial", "src", "app.ts"), "export const a = 1;\n");
    writeFileSync(
      join(dir, "fixture.json"),
      JSON.stringify({
        id: "code-health",
        description: "code health aggregate fixture",
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
              { predicate: { kind: "file-exists", path: "state/done.txt" }, expected: "fail" },
            ],
            predicates: [{ kind: "file-exists", path: "state/done.txt" }],
          },
        ],
        controlDecisions: ["act"],
        provenance: {
          kind: "smoke-fixture",
          justification: "tests code-health aggregation",
        },
      }),
    );
    const report = await runEvalSet({
      projectDir: fixturesRoot,
      fixtures: loadAllFixtures(fixturesRoot),
      executor: {
        preflight: () => EXECUTION_PROFILE,
        execute: async ({ workingDir }) => {
          writeFileSync(join(workingDir, "state", "done.txt"), "ok");
          writeFileSync(
            join(workingDir, "src", "app.ts"),
            "export const a = 1;\nexport const padding = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';\n",
          );
          return { kind: "completed", durationMs: 10, runArtifactPath: null };
        },
      },
      requestedProfile: PROFILE,
      runArtifactBaseDir: runsRoot,
      repeatCount: 1,
    });

    expect(report.aggregate.passAtK).toBe(1);
    expect(report.aggregate.passHatK).toBe(1);
    expect(report.codeHealth).toMatchObject({
      diagnosticRunCount: 1,
      runsWithWarnings: 0,
      fixturesWithWarnings: 0,
      totalWarnings: 0,
      warningCounts: {
        "duplicated-implementation-chunk": 0,
        "complexity-concentration": 0,
      },
    });
    const raw = JSON.parse(
      readFileSync(join(runsRoot, "eval-set-report.json"), "utf-8"),
    );
    expect(raw.codeHealth.totalWarnings).toBe(0);
    expect(raw.runs[0].codeHealthDiagnostics.warningCounts).toEqual({
      "duplicated-implementation-chunk": 0,
      "complexity-concentration": 0,
    });
  });
});
