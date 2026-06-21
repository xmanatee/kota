import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSingleWorkflowFixtureSpec,
  type LoadedFixture,
  loadFixture,
  verifierCalibrationPredicatesForSpec,
} from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import { OFFLINE_CONTAINER_NETWORK_POLICY } from "./provider-egress.js";
import {
  cleanupFixtureWorkingDir,
  runFixture,
  type WorkflowExecutor,
} from "./runner.js";

const FIXTURES_ROOT = join(process.cwd(), "src/modules/eval-harness/fixtures");

const BROAD_ACCEPTED_ALTERNATIVES = new Map([
  ["builder-scientific-claim-reproduction", ["audited-json-evidence"]],
  ["builder-unfamiliar-language-strategy-construction", ["helper-generated-route"]],
  ["builder-dialogue-driven-coding", ["two-turn-sms-confirmation"]],
  ["builder-multi-service-integration", ["segmented-route"]],
  ["builder-empirical-code-optimization", ["coefficient-object"]],
]);

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

describe("broad accepted-alternative fixture calibration", () => {
  it("declares accepted alternatives for selected broad-answer-space fixtures", () => {
    for (const [fixtureId, expectedCaseIds] of BROAD_ACCEPTED_ALTERNATIVES) {
      const fixture = loadFixture(FIXTURES_ROOT, fixtureId);
      expect(isSingleWorkflowFixtureSpec(fixture.spec)).toBe(true);
      const cases = fixture.spec.verifierCalibration?.cases ?? [];
      expect(
        cases
          .filter((entry) => entry.caseKind === "accepted-alternative")
          .map((entry) => entry.id),
      ).toEqual(expectedCaseIds);
      expect(verifierCalibrationPredicatesForSpec(fixture.spec).length).toBeGreaterThan(
        0,
      );
    }
  });
});

function copyCalibrationCaseSetup(
  fixture: LoadedFixture,
  workingDir: string,
  caseId: string,
): void {
  const caseSpec = fixture.spec.verifierCalibration?.cases.find(
    (entry) => entry.id === caseId,
  );
  if (caseSpec === undefined) {
    throw new Error(`Fixture ${fixture.spec.id} has no calibration case ${caseId}.`);
  }
  for (const operation of caseSpec.setup) {
    const targetPath = join(workingDir, operation.targetPath);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(join(fixture.fixtureDir, operation.sourcePath), targetPath);
  }
}

describe("broad accepted-alternative fixture calibration runs", () => {
  it("passes verifier calibration for selected broad fixtures without live model calls", async () => {
    for (const [fixtureId, [acceptedAlternativeId]] of BROAD_ACCEPTED_ALTERNATIVES) {
      const fixture = loadFixture(FIXTURES_ROOT, fixtureId);
      const runArtifactBaseDir = mkdtempSync(
        join(tmpdir(), "kota-broad-alternative-calibration-"),
      );
      let executorCalls = 0;
      const executor: WorkflowExecutor = {
        preflight: () => TEST_EXECUTION_PROFILE,
        execute: async ({ workingDir }) => {
          executorCalls++;
          copyCalibrationCaseSetup(fixture, workingDir, acceptedAlternativeId);
          return { kind: "completed", durationMs: 1, runArtifactPath: null };
        },
      };

      const report = await runFixture({
        fixture,
        executor,
        executionProfile: TEST_EXECUTION_PROFILE,
        runArtifactBaseDir,
        runIndex: 0,
        repeatCount: 1,
      });

      try {
        expect(executorCalls).toBe(1);
        const calibration = JSON.parse(
          readFileSync(
            join(report.run.runArtifactPath, "verifier-calibration.json"),
            "utf8",
          ),
        );
        expect(calibration.passed).toBe(true);
        expect(
          calibration.cases.find(
            (entry: { id: string }) => entry.id === acceptedAlternativeId,
          ),
        ).toMatchObject({
          caseKind: "accepted-alternative",
          expected: "pass",
          passed: true,
          scoringPassed: true,
        });
      } finally {
        cleanupFixtureWorkingDir(report.workingDir);
        rmSync(runArtifactBaseDir, { recursive: true, force: true });
      }
    }
  }, 60_000);

  it("records all calibration case kinds for the changed replay-backed fixture", async () => {
    const fixture = loadFixture(FIXTURES_ROOT, "builder-dialogue-driven-coding");
    const runArtifactBaseDir = mkdtempSync(
      join(tmpdir(), "kota-broad-alternative-calibration-"),
    );
    let executorCalls = 0;
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async ({ workingDir }) => {
        executorCalls++;
        copyCalibrationCaseSetup(
          fixture,
          workingDir,
          "two-turn-sms-confirmation",
        );
        return { kind: "completed", durationMs: 1, runArtifactPath: null };
      },
    };

    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir,
      runIndex: 0,
      repeatCount: 1,
    });

    try {
      expect(executorCalls).toBe(1);
      const calibration = JSON.parse(
        readFileSync(
          join(report.run.runArtifactPath, "verifier-calibration.json"),
          "utf8",
        ),
      );
      expect(calibration.passed).toBe(true);
      expect(
        calibration.cases.map((entry: { id: string; caseKind: string }) => [
          entry.id,
          entry.caseKind,
        ]),
      ).toEqual([
        ["null", "null"],
        ["golden", "golden"],
        ["two-turn-sms-confirmation", "accepted-alternative"],
        ["adversarial", "adversarial"],
      ]);
    } finally {
      cleanupFixtureWorkingDir(report.workingDir);
      rmSync(runArtifactBaseDir, { recursive: true, force: true });
    }
  });
});
