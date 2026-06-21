import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import type { ExecutionProfilePreflightResult } from "./fixture-run.js";
import {
  HOST_SUBPROCESS_NETWORK_POLICY,
} from "./provider-egress.js";

describe("runEvalSet profile validation", () => {
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
      networkPolicy: HOST_SUBPROCESS_NETWORK_POLICY,
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
      networkPolicy: HOST_SUBPROCESS_NETWORK_POLICY,
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
