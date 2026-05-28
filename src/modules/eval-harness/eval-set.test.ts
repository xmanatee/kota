import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runEvalSet } from "./eval-set.js";
import { type FixtureControlDecision, loadAllFixtures } from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import type { WorkflowExecutor } from "./runner.js";

const PROFILE: ResourceProfile = {
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4000,
  memoryKillThresholdMB: 4000,
  hostClass: "test",
};

const EXECUTION_PROFILE: ExecutionProfilePreflightResult = {
  status: "verified",
  backendKind: "container",
  requestedProfile: PROFILE,
  observedOrEnforcedProfile: PROFILE,
  verification: "enforced",
  gateEligible: true,
  eligibilityReason: "verified-profile",
  diagnostics: [],
};

function seedFixture(
  root: string,
  id: string,
  predicate: { kind: "file-exists"; path: string },
  objectiveMetrics?: object[],
  controlDecisions: FixtureControlDecision[] = ["act"],
): void {
  const dir = join(root, id);
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(
    join(dir, "fixture.json"),
    JSON.stringify({
      id,
      description: id,
      role: "builder",
      workflowName: "noop",
      budgetMs: 60_000,
      predicates: [predicate],
      preRunExpectations: [{ predicate, expected: "fail" }],
      controlDecisions,
      ...(objectiveMetrics !== undefined && { objectiveMetrics }),
      provenance: {
        kind: "smoke-fixture",
        justification: "minimal test fixture for eval-set unit tests",
      },
    }),
  );
}

describe("runEvalSet", () => {
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

  it("aggregates pass@k and pass^k across fixtures and writes a report artifact", async () => {
    seedFixture(fixturesRoot, "alpha", { kind: "file-exists", path: "alpha.txt" });
    seedFixture(fixturesRoot, "beta", { kind: "file-exists", path: "beta.txt" });
    const fixtures = loadAllFixtures(fixturesRoot);

    let betaCalls = 0;
    const executor: WorkflowExecutor = {
      preflight: () => EXECUTION_PROFILE,
      execute: async ({ workingDir }) => {
        const isAlpha = workingDir.includes("alpha");
        if (isAlpha) {
          writeFileSync(join(workingDir, "alpha.txt"), "ok");
        } else {
          if (betaCalls === 0) {
            writeFileSync(join(workingDir, "beta.txt"), "ok");
          }
          betaCalls++;
        }
        return { kind: "completed", durationMs: 10, runArtifactPath: null };
      },
    };

    const report = await runEvalSet({
      projectDir: fixturesRoot,
      fixtures,
      executor,
      requestedProfile: PROFILE,
      runArtifactBaseDir: runsRoot,
      repeatCount: 3,
    });

    expect(report.runs).toHaveLength(6);
    expect(report.aggregate.fixtureCount).toBe(2);
    // alpha: 3/3 pass ⇒ passedAll=true; beta: 1/3 pass ⇒ passedAny=true.
    expect(report.aggregate.passAtK).toBeCloseTo(1);
    expect(report.aggregate.passHatK).toBeCloseTo(0.5);
    expect(report.fixtureDiagnostics.aggregate).toEqual({
      fixtureCount: 2,
      stablePass: 1,
      stableFail: 0,
      repeatUnstable: 1,
      insufficientSample: 0,
      nonGating: 0,
      lowSignalWarnings: 1,
    });
    expect(
      report.fixtureDiagnostics.perFixture.find(
        (diagnostic) => diagnostic.fixtureId === "beta",
      ),
    ).toMatchObject({
      outcomes: ["pass", "fail", "fail"],
      diagnosticClass: "repeat-unstable",
      warnings: ["low-signal-repeat-instability"],
    });
    expect(report.controlDecisionCoverage.counts.act).toBe(2);
    expect(report.controlDecisionCoverage.missingDecisions).toContain("ask");

    const raw = JSON.parse(
      readFileSync(join(runsRoot, "eval-set-report.json"), "utf-8"),
    );
    expect(raw.repeatCount).toBe(3);
    expect(raw.executionProfile.status).toBe("verified");
    expect(raw.runs).toHaveLength(6);
    expect(raw.fixtureDiagnostics.aggregate.repeatUnstable).toBe(1);
    expect(raw.fixtureDiagnostics.perFixture).toContainEqual(
      expect.objectContaining({
        fixtureId: "beta",
        outcomes: ["pass", "fail", "fail"],
      }),
    );
    expect(raw.controlDecisionCoverage.counts.act).toBe(2);
    expect(raw.controlDecisionCoverage.missingDecisionWarnings).toContainEqual({
      decision: "ask",
      message: 'No eval fixture declares control decision "ask".',
    });
    expect(raw.runConfiguration.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(raw.runConfiguration.summary.activePreset).toContain("codex");
    expect(raw.runConfiguration.components.fixtureManifest.fixtures).toEqual([
      expect.objectContaining({ id: "alpha" }),
      expect.objectContaining({ id: "beta" }),
    ]);
    expect(raw.runConfiguration.components.sourceIdentity.status).toBe(
      "unavailable",
    );
    expect(
      raw.runConfiguration.components.resolvedHarnessModelEvidence.status,
    ).toBe("missing");
    const preflight = JSON.parse(
      readFileSync(
        join(runsRoot, "eval-resource-profile-preflight.json"),
        "utf-8",
      ),
    );
    expect(preflight.eligibilityReason).toBe("verified-profile");
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

  it("aggregates code-health warning counts without changing pass/fail aggregation", async () => {
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
      runsWithWarnings: 1,
      fixturesWithWarnings: 1,
      totalWarnings: 1,
      warningCounts: {
        "source-size-growth": 1,
        "duplicated-implementation-chunk": 0,
        "complexity-concentration": 0,
      },
    });
    const raw = JSON.parse(
      readFileSync(join(runsRoot, "eval-set-report.json"), "utf-8"),
    );
    expect(raw.codeHealth.warningCounts["source-size-growth"]).toBe(1);
    expect(raw.runs[0].codeHealthDiagnostics.warningCounts["source-size-growth"]).toBe(1);
  });

  it("summarizes resolved harness and model evidence from child workflow artifacts", async () => {
    seedFixture(fixturesRoot, "alpha", { kind: "file-exists", path: "alpha.txt" });
    const report = await runEvalSet({
      projectDir: fixturesRoot,
      fixtures: loadAllFixtures(fixturesRoot),
      executor: {
        preflight: () => EXECUTION_PROFILE,
        execute: async ({ workingDir }) => {
          writeFileSync(join(workingDir, "alpha.txt"), "ok");
          const childRunDir = join(workingDir, ".kota", "runs", "child-run");
          mkdirSync(childRunDir, { recursive: true });
          writeFileSync(
            join(childRunDir, "metadata.json"),
            JSON.stringify({
              id: "child-run",
              workflow: "noop",
              status: "success",
              steps: [
                {
                  id: "build",
                  type: "agent",
                  status: "success",
                  harness: "codex",
                  model: "gpt-5.5",
                },
              ],
            }),
          );
          return {
            kind: "completed",
            durationMs: 10,
            runArtifactPath: childRunDir,
          };
        },
      },
      requestedProfile: PROFILE,
      runArtifactBaseDir: runsRoot,
      repeatCount: 1,
    });

    expect(
      report.runConfiguration.components.resolvedHarnessModelEvidence,
    ).toMatchObject({
      status: "complete",
      distinctHarnessModels: [{ harness: "codex", model: "gpt-5.5", count: 1 }],
    });
    expect(report.runConfiguration.summary.resolvedHarnessModelEvidence).toBe(
      "codex/gpt-5.5 x1",
    );
  });

  it("ignores skipped agent steps when summarizing resolved harness and model evidence", async () => {
    seedFixture(fixturesRoot, "alpha", { kind: "file-exists", path: "alpha.txt" });
    const report = await runEvalSet({
      projectDir: fixturesRoot,
      fixtures: loadAllFixtures(fixturesRoot),
      executor: {
        preflight: () => EXECUTION_PROFILE,
        execute: async ({ workingDir }) => {
          writeFileSync(join(workingDir, "alpha.txt"), "ok");
          const childRunDir = join(workingDir, ".kota", "runs", "child-run");
          mkdirSync(childRunDir, { recursive: true });
          writeFileSync(
            join(childRunDir, "metadata.json"),
            JSON.stringify({
              id: "child-run",
              workflow: "decomposer",
              status: "success",
              steps: [
                {
                  id: "assess-failure",
                  type: "code",
                  status: "success",
                },
                {
                  id: "decompose",
                  type: "agent",
                  status: "skipped",
                  skipReason: { kind: "when-predicate" },
                },
              ],
            }),
          );
          return {
            kind: "completed",
            durationMs: 10,
            runArtifactPath: childRunDir,
          };
        },
      },
      requestedProfile: PROFILE,
      runArtifactBaseDir: runsRoot,
      repeatCount: 1,
    });

    expect(
      report.runConfiguration.components.resolvedHarnessModelEvidence,
    ).toMatchObject({
      status: "empty",
      observations: [],
      missingArtifacts: [],
      distinctHarnessModels: [],
    });
    expect(report.runConfiguration.summary.resolvedHarnessModelEvidence).toBe(
      "no agent-step evidence",
    );
  });

  it("does not compare objective metric deltas across incompatible environments", async () => {
    seedFixture(
      fixturesRoot,
      "resource-drift",
      { kind: "file-exists", path: "resource.txt" },
      [
        {
          name: "duration",
          unit: "ms",
          direction: "lower_is_better",
          source: { kind: "text-file", path: "metric.txt" },
          comparisonBaseline: {
            value: 10,
            resourceProfile: { ...PROFILE, hostClass: "other-host" },
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
    const resourceReport = await runEvalSet({
      projectDir: fixturesRoot,
      fixtures: loadAllFixtures(fixturesRoot),
      executor: {
        preflight: () => EXECUTION_PROFILE,
        execute: async ({ workingDir }) => {
          writeFileSync(join(workingDir, "resource.txt"), "ok");
          writeFileSync(join(workingDir, "metric.txt"), "8");
          return { kind: "completed", durationMs: 10, runArtifactPath: null };
        },
      },
      requestedProfile: PROFILE,
      runArtifactBaseDir: runsRoot,
      repeatCount: 1,
    });
    expect(resourceReport.objectiveMetrics[0].comparison).toMatchObject({
      status: "not-compared",
      reason: "resource-profile-incomparable",
    });

    rmSync(fixturesRoot, { recursive: true, force: true });
    fixturesRoot = mkdtempSync(join(tmpdir(), "kota-eval-harness-set-fx-"));
    seedFixture(
      fixturesRoot,
      "execution-drift",
      { kind: "file-exists", path: "execution.txt" },
      [
        {
          name: "duration",
          unit: "ms",
          direction: "lower_is_better",
          source: { kind: "text-file", path: "metric.txt" },
          comparisonBaseline: {
            value: 10,
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
    const nonGatingProfile: ExecutionProfilePreflightResult = {
      status: "non-gating",
      backendKind: "host-subprocess",
      requestedProfile: PROFILE,
      observedOrEnforcedProfile: PROFILE,
      verification: "unverified",
      gateEligible: false,
      nonGatingReason: "host-subprocess-unverified",
      diagnostics: [],
    };
    const executionReport = await runEvalSet({
      projectDir: fixturesRoot,
      fixtures: loadAllFixtures(fixturesRoot),
      executor: {
        preflight: () => nonGatingProfile,
        execute: async ({ workingDir }) => {
          writeFileSync(join(workingDir, "execution.txt"), "ok");
          writeFileSync(join(workingDir, "metric.txt"), "8");
          return { kind: "completed", durationMs: 10, runArtifactPath: null };
        },
      },
      requestedProfile: PROFILE,
      runArtifactBaseDir: runsRoot,
      repeatCount: 1,
    });
    expect(executionReport.objectiveMetrics[0].comparison).toMatchObject({
      status: "not-compared",
      reason: "execution-profile-incomparable",
    });
  });

  it("rejects non-positive repeat counts", async () => {
    seedFixture(fixturesRoot, "alpha", { kind: "file-exists", path: "alpha.txt" });
    const fixtures = loadAllFixtures(fixturesRoot);
    await expect(
      runEvalSet({
        projectDir: fixturesRoot,
        fixtures,
        executor: {
          preflight: () => EXECUTION_PROFILE,
          execute: async () => ({
            kind: "completed",
            durationMs: 0,
            runArtifactPath: null,
          }),
        },
        requestedProfile: PROFILE,
        runArtifactBaseDir: runsRoot,
        repeatCount: 0,
      }),
    ).rejects.toThrow(/positive integer/);
  });

  it("rejects empty fixture sets rather than returning a vacuous 0/0 score", async () => {
    await expect(
      runEvalSet({
        projectDir: fixturesRoot,
        fixtures: [],
        executor: {
          preflight: () => EXECUTION_PROFILE,
          execute: async () => ({
            kind: "completed",
            durationMs: 0,
            runArtifactPath: null,
          }),
        },
        requestedProfile: PROFILE,
        runArtifactBaseDir: runsRoot,
        repeatCount: 1,
      }),
    ).rejects.toThrow(/empty fixture set/);
  });

  it("rejects requested/observed execution-profile mismatches before scoring", async () => {
    seedFixture(fixturesRoot, "alpha", { kind: "file-exists", path: "alpha.txt" });
    const fixtures = loadAllFixtures(fixturesRoot);
    const rejectedProfile: ExecutionProfilePreflightResult = {
      status: "rejected",
      backendKind: "host-subprocess",
      requestedProfile: PROFILE,
      observedOrEnforcedProfile: {
        ...PROFILE,
        cpuKillThresholdCores: PROFILE.cpuKillThresholdCores + 1,
      },
      verification: "observed",
      gateEligible: false,
      rejectionReason: "requested-observed-mismatch",
      diagnostics: [],
    };
    let executeCalls = 0;

    await expect(
      runEvalSet({
        projectDir: fixturesRoot,
        fixtures,
        executor: {
          preflight: () => rejectedProfile,
          execute: async () => {
            executeCalls++;
            return {
              kind: "completed",
              durationMs: 0,
              runArtifactPath: null,
            };
          },
        },
        requestedProfile: PROFILE,
        runArtifactBaseDir: runsRoot,
        repeatCount: 1,
      }),
    ).rejects.toThrow(/requested-observed-mismatch/);
    expect(executeCalls).toBe(0);
  });
});
