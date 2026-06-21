import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROVIDER_EGRESS_NETWORK_LABELS,
  providerEgressEndpointLabelValue,
  providerEgressEndpointsFor,
} from "./provider-egress.js";
import {
  createSubprocessExecutor,
  detectHostSubprocessResourceProfile,
} from "./subprocess-executor.js";
import {
  cleanupSubprocessTestDirs,
  createSubprocessTestDirs,
  type SubprocessTestDirs,
  writeFakeContainerBackend,
} from "./subprocess-executor-test-helpers.js";

describe("createSubprocessExecutor container preflight", () => {
  let dirs: SubprocessTestDirs;

  beforeEach(() => {
    dirs = createSubprocessTestDirs();
  });

  afterEach(() => {
    delete process.env.KOTA_FAKE_CONTAINER_NETWORK_LABELS;
    cleanupSubprocessTestDirs(dirs);
  });

  it("reports a missing optional container backend as typed non-gating preflight", () => {
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(dirs.binariesDir, "unused.mjs"),
      isolationBackend: {
        kind: "container",
        executable: "kota-eval-missing-container-backend",
        image: "kota-eval:latest",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
    });
    const requestedProfile = detectHostSubprocessResourceProfile("host-test");
    const preflight = executor.preflight(requestedProfile);

    expect(preflight.status).toBe("non-gating");
    expect(preflight.backendKind).toBe("missing-isolation-backend");
    if (preflight.status !== "non-gating") throw new Error("unreachable");
    expect(preflight.nonGatingReason).toBe("isolation-backend-unavailable");
  });

  it("reports container image/config problems as typed non-gating preflight", () => {
    const fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    writeFakeContainerBackend(fakeContainer);
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(dirs.binariesDir, "unused.mjs"),
      isolationBackend: {
        kind: "container",
        executable: fakeContainer,
        image: "missing:image",
        kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      },
    });
    const preflight = executor.preflight(containerProfile());

    expect(preflight.status).toBe("non-gating");
    expect(preflight.backendKind).toBe("container");
    if (preflight.status !== "non-gating") throw new Error("unreachable");
    expect(preflight.nonGatingReason).toBe(
      "isolation-backend-config-invalid",
    );
    expect(preflight.gateEligible).toBe(false);
  });

  it("rejects container resource profiles the backend cannot represent", () => {
    const fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    writeFakeContainerBackend(fakeContainer);
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(dirs.binariesDir, "unused.mjs"),
      isolationBackend: containerBackend(fakeContainer),
    });
    const preflight = executor.preflight({
      hostClass: "container-test",
      cpuAllocationCores: 1,
      cpuKillThresholdCores: 2,
      memoryAllocationMB: 1024,
      memoryKillThresholdMB: 1024,
    });

    expect(preflight.status).toBe("rejected");
    if (preflight.status !== "rejected") throw new Error("unreachable");
    expect(preflight.backendKind).toBe("container");
    expect(preflight.rejectionReason).toBe("requested-observed-mismatch");
    expect(preflight.observedOrEnforcedProfile.cpuAllocationCores).toBe(2);
  });

  it("verifies an available container backend as gate-eligible enforced profile", () => {
    const fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    writeFakeContainerBackend(fakeContainer);
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(dirs.binariesDir, "unused.mjs"),
      isolationBackend: containerBackend(fakeContainer),
    });
    const requestedProfile = containerProfile();
    const preflight = executor.preflight(requestedProfile);

    expect(preflight.status).toBe("verified");
    expect(preflight.backendKind).toBe("container");
    expect(preflight.verification).toBe("enforced");
    expect(preflight.gateEligible).toBe(true);
    expect(preflight.observedOrEnforcedProfile).toEqual(requestedProfile);
  });

  it("marks provider-egress non-gating when the whole fixture container shares the provider network", () => {
    const fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    writeFakeContainerBackend(fakeContainer);
    const allowedEndpoints = providerEgressEndpointsFor("openai");
    process.env.KOTA_FAKE_CONTAINER_NETWORK_LABELS = JSON.stringify({
      [PROVIDER_EGRESS_NETWORK_LABELS.policy]: "provider-egress",
      [PROVIDER_EGRESS_NETWORK_LABELS.provider]: "openai",
      [PROVIDER_EGRESS_NETWORK_LABELS.endpoints]:
        providerEgressEndpointLabelValue(allowedEndpoints),
    });
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(dirs.binariesDir, "unused.mjs"),
      providerEgressTaskBoundary: {
        agentHarness: "openai-tools",
        toolControl: "kota",
      },
      isolationBackend: providerEgressBackend(fakeContainer),
    });
    const preflight = executor.preflight(containerProfile());

    expect(preflight.status).toBe("non-gating");
    if (preflight.status !== "non-gating") throw new Error("unreachable");
    expect(preflight.backendKind).toBe("container");
    expect(preflight.verification).toBe("enforced");
    expect(preflight.gateEligible).toBe(false);
    expect(preflight.nonGatingReason).toBe(
      "provider-egress-task-boundary-unverified",
    );
    expect(preflight.networkPolicy).toMatchObject({
      kind: "provider-egress",
      provider: "openai",
      enforcementMode: "docker-internal-proxy",
      networkName: "kota-provider-egress",
      proxyUrl: "http://provider-proxy:8080",
      containerNetworkScope: "whole-container-provider-proxy",
      taskSubprocessBoundary: {
        kind: "kota-tool-provider-env-filter",
        agentHarness: "openai-tools",
        providerProxyEnv: "stripped",
        providerAuthEnv: "stripped",
        networkBoundary: "shared-container-network",
        gateEligible: false,
      },
      gateEligible: false,
    });
    expect(preflight.networkPolicy.allowedProviderEndpoints).toEqual(
      allowedEndpoints,
    );
  });

  it("marks provider-egress non-gating for native CLI tool runtimes", () => {
    const fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    writeFakeContainerBackend(fakeContainer);
    seedOpenAiNetworkLabels();
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(dirs.binariesDir, "unused.mjs"),
      providerEgressTaskBoundary: {
        agentHarness: "codex",
        toolControl: "native",
      },
      isolationBackend: providerEgressBackend(fakeContainer),
    });
    const preflight = executor.preflight(containerProfile());

    expect(preflight.status).toBe("non-gating");
    if (preflight.status !== "non-gating") throw new Error("unreachable");
    expect(preflight.nonGatingReason).toBe(
      "provider-egress-task-boundary-unverified",
    );
    expect(preflight.networkPolicy).toMatchObject({
      kind: "provider-egress",
      enforcementMode: "docker-internal-proxy",
      taskSubprocessBoundary: {
        kind: "native-tool-runtime-unverified",
        agentHarness: "codex",
        gateEligible: false,
      },
      gateEligible: false,
    });
  });

  it("marks provider-egress non-gating when the Docker network cannot enforce it", () => {
    const fakeContainer = join(dirs.binariesDir, "fake-container.mjs");
    writeFakeContainerBackend(fakeContainer);
    const executor = createSubprocessExecutor({
      kotaBinaryPath: join(dirs.binariesDir, "unused.mjs"),
      isolationBackend: {
        ...providerEgressBackend(fakeContainer),
        networkPolicy: {
          kind: "provider-egress",
          provider: "openai",
          enforcement: {
            kind: "docker-internal-proxy",
            networkName: "missing-network",
            proxyUrl: "http://provider-proxy:8080",
          },
        },
      },
    });
    const preflight = executor.preflight(containerProfile());

    expect(preflight.status).toBe("non-gating");
    if (preflight.status !== "non-gating") throw new Error("unreachable");
    expect(preflight.nonGatingReason).toBe(
      "provider-egress-enforcement-unavailable",
    );
    expect(preflight.networkPolicy).toMatchObject({
      kind: "provider-egress",
      enforcementMode: "unavailable",
      gateEligible: false,
    });
  });
});

function containerProfile() {
  return {
    hostClass: "container-test",
    cpuAllocationCores: 2,
    cpuKillThresholdCores: 2,
    memoryAllocationMB: 1024,
    memoryKillThresholdMB: 2048,
  };
}

function containerBackend(executable: string) {
  return {
    kind: "container" as const,
    executable,
    image: "kota-eval:latest",
    kotaBinaryPath: "/opt/kota/bin/kota.mjs",
  };
}

function providerEgressBackend(executable: string) {
  return {
    ...containerBackend(executable),
    networkPolicy: {
      kind: "provider-egress" as const,
      provider: "openai" as const,
      enforcement: {
        kind: "docker-internal-proxy" as const,
        networkName: "kota-provider-egress",
        proxyUrl: "http://provider-proxy:8080",
      },
    },
  };
}

function seedOpenAiNetworkLabels(): void {
  const allowedEndpoints = providerEgressEndpointsFor("openai");
  process.env.KOTA_FAKE_CONTAINER_NETWORK_LABELS = JSON.stringify({
    [PROVIDER_EGRESS_NETWORK_LABELS.policy]: "provider-egress",
    [PROVIDER_EGRESS_NETWORK_LABELS.provider]: "openai",
    [PROVIDER_EGRESS_NETWORK_LABELS.endpoints]:
      providerEgressEndpointLabelValue(allowedEndpoints),
  });
}
