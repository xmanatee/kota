import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDefaultModel, resolvePreset } from "#core/model/preset.js";
import type { AgyModelEvaluationOptions } from "./agy-model-evaluation-types.js";
import type { ExecutableVerifier } from "./executable-verifier-sandbox.js";
import type { ExecutionProfilePreflightResult } from "./fixture-run.js";
import {
  PROVIDER_EGRESS_NETWORK_LABELS,
  providerEgressEndpointLabelValue,
  providerEgressEndpointsFor,
} from "./provider-egress.js";
import { TEST_PROFILE } from "./runner-test-profiles.js";
import { writeFakeContainerBackend } from "./subprocess-executor-test-helpers.js";

const tempDirs: string[] = [];
const AGY_TEST_MODEL = resolveDefaultModel(
  resolvePreset({ flag: "antigravity-cli" }).preset,
);

export const AGY_OPTIONS: AgyModelEvaluationOptions = {
  candidates: [AGY_TEST_MODEL],
  repeatCount: 1,
  effort: "max",
  isolationBackend: {
    kind: "container",
    executable: "docker",
    image: "kota-eval:latest",
    kotaBinaryPath: "/opt/kota/bin/kota.mjs",
    networkPolicy: {
      kind: "provider-egress",
      provider: "google",
      enforcement: {
        kind: "docker-internal-proxy",
        networkName: "kota-google-egress",
        proxyUrl: "http://provider-proxy:8080",
      },
    },
  },
};

export const AGY_EXECUTION_PROFILE: ExecutionProfilePreflightResult = {
  status: "non-gating",
  backendKind: "container",
  requestedProfile: TEST_PROFILE,
  observedOrEnforcedProfile: TEST_PROFILE,
  verification: "enforced",
  networkPolicy: {
    kind: "provider-egress",
    provider: "google",
    enforcementMode: "docker-internal-proxy",
    networkName: "kota-google-egress",
    proxyUrl: "http://provider-proxy:8080",
    allowedProviderEndpoints: providerEgressEndpointsFor("google"),
    containerNetworkScope: "whole-container-provider-proxy",
    taskSubprocessBoundary: {
      kind: "native-tool-runtime-unverified",
      agentHarness: "antigravity-cli",
      gateEligible: false,
    },
    gateEligible: false,
  },
  gateEligible: false,
  nonGatingReason: "provider-egress-task-boundary-unverified",
  diagnostics: [],
};

export function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

export function configureFakeCandidateContainer(
  runtimeDir: string,
  containerLog: string,
): AgyModelEvaluationOptions {
  const fakeContainer = join(runtimeDir, "fake-container.mjs");
  writeFakeContainerBackend(fakeContainer);
  process.env.KOTA_FAKE_CONTAINER_AGY_MODELS = `${AGY_TEST_MODEL}-high`;
  process.env.KOTA_FAKE_CONTAINER_LOG = containerLog;
  process.env.KOTA_FAKE_CONTAINER_NETWORK_LABELS = JSON.stringify({
    [PROVIDER_EGRESS_NETWORK_LABELS.policy]: "provider-egress",
    [PROVIDER_EGRESS_NETWORK_LABELS.provider]: "google",
    [PROVIDER_EGRESS_NETWORK_LABELS.endpoints]:
      providerEgressEndpointLabelValue(providerEgressEndpointsFor("google")),
  });
  return {
    ...AGY_OPTIONS,
    isolationBackend: {
      ...AGY_OPTIONS.isolationBackend,
      executable: fakeContainer,
    },
  };
}

export const executeVerifierOnTestHost: ExecutableVerifier = async ({
  workingDir,
  command,
  timeoutMs,
  maxBuffer,
}) => {
  const result = spawnSync("/bin/sh", ["-c", command], {
    cwd: workingDir,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    started: true,
    isolation: {
      kind: "oci-container",
      command: "test-verifier-boundary",
      image: "kota-eval:test",
      cliEnv: {},
      evidence:
        "test-only executable boundary exercising real fixture calibration",
    },
    result: {
      ...(result.error !== undefined && { error: result.error }),
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    },
  };
};

export function cleanupAgyModelEvaluationTestEnvironment(): void {
  delete process.env.KOTA_FAKE_CONTAINER_AGY_MODELS;
  delete process.env.KOTA_FAKE_CONTAINER_LOG;
  delete process.env.KOTA_FAKE_CONTAINER_NETWORK_LABELS;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
