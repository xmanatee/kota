import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runEvalSet } from "./eval-set.js";
import { loadAllFixtures } from "./fixture.js";
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

    const raw = JSON.parse(
      readFileSync(join(runsRoot, "eval-set-report.json"), "utf-8"),
    );
    expect(raw.repeatCount).toBe(3);
    expect(raw.executionProfile.status).toBe("verified");
    expect(raw.runs).toHaveLength(6);
    const preflight = JSON.parse(
      readFileSync(
        join(runsRoot, "eval-resource-profile-preflight.json"),
        "utf-8",
      ),
    );
    expect(preflight.eligibilityReason).toBe("verified-profile");
  });

  it("rejects non-positive repeat counts", async () => {
    seedFixture(fixturesRoot, "alpha", { kind: "file-exists", path: "alpha.txt" });
    const fixtures = loadAllFixtures(fixturesRoot);
    await expect(
      runEvalSet({
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
