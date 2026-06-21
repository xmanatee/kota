import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runEvalSet } from "./eval-set.js";
import {
  EXECUTION_PROFILE,
  PROFILE,
  seedAcceptedAlternativeFailureFixture,
  seedFixture,
} from "./eval-set-test-support.js";
import { loadAllFixtures } from "./fixture.js";
import type { WorkflowExecutor } from "./runner.js";

describe("runEvalSet aggregation", () => {
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
    expect(raw.runs).toEqual(
      expect.arrayContaining([expect.objectContaining({ executionMode: "live" })]),
    );
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
    expect(raw.componentAttribution.schemaVersion).toBe(1);
    expect(raw.componentAttribution.baseline.status).toBe("no-baseline");
    expect(raw.componentAttribution.components.map((entry: { id: string }) => entry.id)).toEqual([
      "model-preset",
      "harness-execution",
      "prompt-skill-context",
      "fixture-verifier",
      "environment-resource",
      "feedback-loop",
    ]);
    expect(raw.componentAttribution.perFixture).toContainEqual(
      expect.objectContaining({
        fixtureId: "beta",
        outcomeDelta: "no-baseline",
      }),
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

  it("surfaces accepted alternative calibration failures before aggregate scoring", async () => {
    seedAcceptedAlternativeFailureFixture(fixturesRoot);
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
        repeatCount: 1,
      }),
    ).rejects.toThrow(/alternate-output/);

    const calibration = JSON.parse(
      readFileSync(
        join(runsRoot, "accepted-alternative-failure-0", "verifier-calibration.json"),
        "utf-8",
      ),
    );
    expect(
      calibration.cases.find((entry: { id: string }) => entry.id === "alternate-output"),
    ).toMatchObject({
      caseKind: "accepted-alternative",
      passed: false,
    });
  });
});
