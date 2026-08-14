import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowCodeStepContext } from "#core/workflow/step-input-code.js";
import { evalHarnessCadenceOperation } from "./cadence-operation.js";
import {
  EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV,
  EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV,
  EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV,
  isCadenceIsolationConfigured,
  resolveCadenceIsolationBackend,
  runHarness,
} from "./cadence-workflow.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("eval-harness cadence isolation backend selection", () => {
  it("keeps cadence disabled without a verified container backend", () => {
    expect(isCadenceIsolationConfigured({})).toBe(false);
    expect(() => resolveCadenceIsolationBackend({})).toThrow(
      /must be set together/,
    );
  });

  it("selects a strict container backend only when all cadence env fields are set", () => {
    const env = {
      [EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV]: "docker",
      [EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV]: "node:22-bookworm",
      [EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV]:
        "/opt/kota/bin/kota.mjs",
    };
    expect(isCadenceIsolationConfigured(env)).toBe(true);
    expect(resolveCadenceIsolationBackend(env)).toEqual({
      kind: "container",
      executable: "docker",
      image: "node:22-bookworm",
      kotaBinaryPath: "/opt/kota/bin/kota.mjs",
    });
  });

  it("fails loudly on incomplete cadence container config", () => {
    expect(() =>
      isCadenceIsolationConfigured({
        [EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV]: "docker",
      }),
    ).toThrow(/must be set together/);
  });

  it("fails loudly on empty cadence container config values", () => {
    expect(() =>
      resolveCadenceIsolationBackend({
        [EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV]: "",
        [EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV]: "node:22-bookworm",
      }),
    ).toThrow(/must be set together/);
  });

  it("fails loudly on relative cadence container binary paths", () => {
    expect(() =>
      resolveCadenceIsolationBackend({
        [EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV]: "docker",
        [EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV]: "node:22-bookworm",
        [EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV]:
          "bin/kota.mjs",
      }),
    ).toThrow(/absolute container path/);
  });

  it("delegates cadence work to the blocking-operation worker before emitting events", async () => {
    vi.stubEnv(EVAL_HARNESS_CADENCE_CONTAINER_EXECUTABLE_ENV, "docker");
    vi.stubEnv(EVAL_HARNESS_CADENCE_CONTAINER_IMAGE_ENV, "node:22-bookworm");
    vi.stubEnv(
      EVAL_HARNESS_CADENCE_CONTAINER_KOTA_BINARY_PATH_ENV,
      "/opt/kota/bin/kota.mjs",
    );
    const fixtureDiagnostics = {
      fixtureCount: 1,
      stablePass: 1,
      stableFail: 0,
      repeatUnstable: 0,
      insufficientSample: 0,
      nonGating: 0,
      lowSignalWarnings: 0,
    };
    const result = {
      fixtureCount: 1,
      repeatCount: 3,
      passAtK: 1,
      passHatK: 1,
      fixtureDiagnostics,
      runArtifactBaseDir: "/run/eval-runs",
      assessmentStatus: "gated" as const,
    };
    const regressionEvent = {
      baseline: {
        fixtureCount: 1,
        repeatCount: 3,
        passAtK: 1,
        passHatK: 1,
      },
      candidate: {
        fixtureCount: 1,
        repeatCount: 3,
        passAtK: 1,
        passHatK: 1,
      },
      hostClass: "autonomy-cadence",
      noiseBandPercentagePoints: 5,
      dropPercentagePoints: 6,
      runArtifactBaseDir: "/run/eval-runs",
      reason: "fixture regression",
    };
    const completedEvent = {
      fixtureCount: 1,
      repeatCount: 3,
      passAtK: 1,
      passHatK: 1,
      fixtureDiagnostics,
      hostClass: "autonomy-cadence",
      runArtifactBaseDir: "/run/eval-runs",
      runConfigurationFingerprint: "fingerprint",
      runConfigurationSummary: {
        activePreset: "preset",
        fixtureManifest: "fixtures",
        sourceIdentity: "source",
        resolvedHarnessModelEvidence: "models",
        resourceProfile: "resources",
        executionProfile: "execution",
      },
      startedAt: "2026-08-14T00:00:00.000Z",
      completedAt: "2026-08-14T01:00:00.000Z",
    };
    const runBlocking = vi.fn().mockResolvedValue({
      result,
      completedEvent,
      regressionEvent,
    });
    const emit = vi.fn();
    const context = {
      projectDir: "/project",
      workflow: { runDirPath: "/run" },
      runBlocking,
      emit,
    } as unknown as WorkflowCodeStepContext;

    await expect(runHarness.run(context)).resolves.toEqual(result);
    expect(runBlocking).toHaveBeenCalledWith(evalHarnessCadenceOperation, {
      projectDir: "/project",
      runDirPath: "/run",
      isolationBackend: {
        kind: "container",
        executable: "docker",
        image: "node:22-bookworm",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
    });
    expect(emit).toHaveBeenNthCalledWith(
      1,
      "eval-harness.regression.detected",
      regressionEvent,
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      "eval-harness.set.completed",
      completedEvent,
    );
  });
});
