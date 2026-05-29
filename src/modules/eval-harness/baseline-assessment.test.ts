import { describe, expect, it } from "vitest";
import {
  assessAgainstBaseline,
  type CandidateAssessment,
} from "./baseline-assessment.js";
import type { PersistedBaseline } from "./baseline-store.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import {
  HOST_SUBPROCESS_NETWORK_POLICY,
  OFFLINE_CONTAINER_NETWORK_POLICY,
} from "./provider-egress.js";
import type { EvalRunConfiguration } from "./run-configuration.js";

const stableProfile: ResourceProfile = {
  hostClass: "autonomy-cadence",
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4096,
  memoryKillThresholdMB: 4096,
};

const driftedProfile: ResourceProfile = {
  ...stableProfile,
  cpuKillThresholdCores: 4,
};

function verifiedProfile(
  profile: ResourceProfile = stableProfile,
): ExecutionProfilePreflightResult {
  return {
    status: "verified",
    backendKind: "container",
    requestedProfile: profile,
    observedOrEnforcedProfile: profile,
    verification: "enforced",
    networkPolicy: OFFLINE_CONTAINER_NETWORK_POLICY,
    gateEligible: true,
    eligibilityReason: "verified-profile",
    diagnostics: [],
  };
}

function observedVerifiedProfile(
  profile: ResourceProfile = stableProfile,
): ExecutionProfilePreflightResult {
  return {
    status: "verified",
    backendKind: "container",
    requestedProfile: profile,
    observedOrEnforcedProfile: profile,
    verification: "observed",
    networkPolicy: OFFLINE_CONTAINER_NETWORK_POLICY,
    gateEligible: true,
    eligibilityReason: "verified-profile",
    diagnostics: [],
  };
}

function candidate(
  passHatK: number,
  passAtK: number,
  overrides: Partial<CandidateAssessment> = {},
): CandidateAssessment {
  return {
    aggregate: { fixtureCount: 4, repeatCount: 3, passAtK, passHatK },
    executionProfile: verifiedProfile(),
    runConfiguration: runConfiguration(),
    runArtifactBaseDir: "/tmp/fresh/eval-runs",
    recordedAt: "2026-04-27T12:00:00.000Z",
    ...overrides,
  };
}

function baseline(passHatK: number, passAtK: number, k = 3): PersistedBaseline {
  return {
    aggregate: { fixtureCount: 4, repeatCount: k, passAtK, passHatK },
    resourceProfile: stableProfile,
    runConfiguration: runConfiguration(),
    recordedAt: "2026-04-20T12:00:00.000Z",
    runArtifactBaseDir: "/tmp/prior/eval-runs",
  };
}

function runConfiguration(
  overrides: Partial<EvalRunConfiguration["components"]> & {
    fingerprint?: string;
  } = {},
): EvalRunConfiguration {
  const { fingerprint, ...componentOverrides } = overrides;
  const components: EvalRunConfiguration["components"] = {
    activePreset: {
      id: "codex",
      source: "default",
      harness: "codex",
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      tiers: {
        fast: "gpt-5.4-mini",
        balanced: "gpt-5.4",
        capable: "gpt-5.5",
      },
    },
    fixtureManifest: {
      fixtureCount: 4,
      hash: "fixture-hash-a",
      fixtures: [],
    },
    sourceIdentity: {
      status: "available",
      headSha: "a".repeat(40),
      dirty: false,
      statusHash: "status-a",
      sourceHash: "source-a",
    },
    resolvedHarnessModelEvidence: {
      status: "complete",
      observations: [],
      missingArtifacts: [],
      distinctHarnessModels: [
        { harness: "codex", model: "gpt-5.5", count: 4 },
      ],
    },
    resourceProfile: stableProfile,
    executionProfile: verifiedProfile(),
    ...componentOverrides,
  };
  return {
    fingerprint: fingerprint ?? "fingerprint-a",
    summary: {
      activePreset: `${components.activePreset.id} via ${components.activePreset.harness}`,
      fixtureManifest: `${components.fixtureManifest.fixtureCount} fixture(s)`,
      sourceIdentity:
        components.sourceIdentity.status === "available"
          ? components.sourceIdentity.headSha.slice(0, 12)
          : `unavailable:${components.sourceIdentity.reason}`,
      resolvedHarnessModelEvidence:
        components.resolvedHarnessModelEvidence.status,
      resourceProfile: components.resourceProfile.hostClass,
      executionProfile: components.executionProfile.status,
    },
    components,
  };
}

describe("assessAgainstBaseline", () => {
  it("first-run (no prior baseline) records the candidate but does not gate", () => {
    const result = assessAgainstBaseline(null, candidate(1, 1));
    expect(result.status).toBe("first-run");
    if (result.status !== "first-run") throw new Error("unreachable");
    expect(result.baselineToRecord.aggregate.passHatK).toBe(1);
    expect(result.baselineToRecord.recordedAt).toBe(
      "2026-04-27T12:00:00.000Z",
    );
  });

  it("gates on a pass^k drop beyond the noise band with a stable profile", () => {
    const result = assessAgainstBaseline(
      baseline(0.95, 0.95),
      candidate(0.7, 0.95),
    );
    expect(result.status).toBe("gated");
    if (result.status !== "gated") throw new Error("unreachable");
    expect(result.dropPercentagePoints).toBeCloseTo(25, 5);
    expect(result.reason).toContain("pass^k dropped");
    expect(result.priorBaseline.aggregate.passHatK).toBe(0.95);
  });

  it("rolls baseline forward on a not-gated outcome within the noise band", () => {
    const result = assessAgainstBaseline(
      baseline(0.95, 0.95),
      candidate(0.94, 0.95),
    );
    expect(result.status).toBe("not-gated");
    if (result.status !== "not-gated") throw new Error("unreachable");
    expect(result.reason).toBe("within-noise-band");
    expect(result.baselineToRecord.aggregate.passHatK).toBe(0.94);
    expect(result.baselineToRecord.recordedAt).toBe(
      "2026-04-27T12:00:00.000Z",
    );
  });

  it("resource-profile drift resolves to not-gated even on a large drop", () => {
    const executionProfile = verifiedProfile(driftedProfile);
    const result = assessAgainstBaseline(
      baseline(0.95, 0.95),
      candidate(0.4, 0.8, {
        executionProfile,
        runConfiguration: runConfiguration({
          resourceProfile: driftedProfile,
          executionProfile,
          fingerprint: "fingerprint-resource-b",
        }),
      }),
    );
    expect(result.status).toBe("not-gated");
    if (result.status !== "not-gated") throw new Error("unreachable");
    expect(result.reason).toBe("resource-profile-drift");
    expect(result.baselineToRecord.resourceProfile).toEqual(driftedProfile);
  });

  it("refuses baseline comparison when the execution profile is non-gating", () => {
    const executionProfile: ExecutionProfilePreflightResult = {
      status: "non-gating",
      backendKind: "host-subprocess",
      requestedProfile: stableProfile,
      observedOrEnforcedProfile: stableProfile,
      verification: "unverified",
      networkPolicy: HOST_SUBPROCESS_NETWORK_POLICY,
      gateEligible: false,
      nonGatingReason: "host-subprocess-unverified",
      diagnostics: [],
    };
    const result = assessAgainstBaseline(
      baseline(1, 1),
      candidate(0, 0, { executionProfile }),
    );
    expect(result.status).toBe("non-gating");
    if (result.status !== "non-gating") throw new Error("unreachable");
    expect(result.reason).toBe("host-subprocess-unverified");
  });

  it("rejects requested/observed mismatches before comparing baseline scores", () => {
    const executionProfile: ExecutionProfilePreflightResult = {
      status: "rejected",
      backendKind: "host-subprocess",
      requestedProfile: stableProfile,
      observedOrEnforcedProfile: driftedProfile,
      verification: "observed",
      networkPolicy: HOST_SUBPROCESS_NETWORK_POLICY,
      gateEligible: false,
      rejectionReason: "requested-observed-mismatch",
      diagnostics: [],
    };
    const result = assessAgainstBaseline(
      baseline(1, 1),
      candidate(0, 0, { executionProfile }),
    );
    expect(result.status).toBe("non-gating");
    if (result.status !== "non-gating") throw new Error("unreachable");
    expect(result.reason).toBe("requested-observed-mismatch");
  });

  it("repeat-count-below-minimum resolves to not-gated even on a 100pp drop", () => {
    const result = assessAgainstBaseline(
      baseline(1, 1, 2),
      candidate(0, 0, {
        aggregate: { fixtureCount: 4, repeatCount: 2, passAtK: 0, passHatK: 0 },
      }),
    );
    expect(result.status).toBe("not-gated");
    if (result.status !== "not-gated") throw new Error("unreachable");
    expect(result.reason).toBe("repeat-count-below-minimum");
  });

  it("passes the configured noise band through to the gate", () => {
    const result = assessAgainstBaseline(
      baseline(0.95, 0.95),
      candidate(0.9, 0.95, { noiseBandPercentagePoints: 10 }),
    );
    expect(result.status).toBe("not-gated");
    if (result.status !== "not-gated") throw new Error("unreachable");
    expect(result.reason).toBe("within-noise-band");
    expect(result.noiseBandPercentagePoints).toBe(10);
  });

  it("treats active preset drift as a non-gating fresh population", () => {
    const result = assessAgainstBaseline(
      baseline(1, 1),
      candidate(0, 0, {
        runConfiguration: runConfiguration({
          activePreset: {
            id: "claude",
            source: "env",
            harness: "claude-agent-sdk",
            defaultModel: "claude-sonnet-4-6",
            defaultEffort: "xhigh",
            tiers: {
              fast: "claude-haiku-4-5-20251001",
              balanced: "claude-sonnet-4-6",
              capable: "claude-opus-4-7",
            },
          },
          fingerprint: "fingerprint-preset-b",
        }),
      }),
    );
    expect(result.status).toBe("non-gating");
    if (result.status !== "non-gating" || result.kind !== "run-configuration") {
      throw new Error("unreachable");
    }
    expect(result.reason).toBe("active-preset-drift");
    expect(result.baselineToRecord.runConfiguration.fingerprint).toBe(
      "fingerprint-preset-b",
    );
  });

  it("treats fixture-manifest drift as a typed non-gating comparison", () => {
    const result = assessAgainstBaseline(
      baseline(1, 1),
      candidate(0, 0, {
        runConfiguration: runConfiguration({
          fixtureManifest: {
            fixtureCount: 5,
            hash: "fixture-hash-b",
            fixtures: [],
          },
          fingerprint: "fingerprint-fixture-b",
        }),
      }),
    );
    expect(result.status).toBe("non-gating");
    if (result.status !== "non-gating" || result.kind !== "run-configuration") {
      throw new Error("unreachable");
    }
    expect(result.reason).toBe("fixture-manifest-drift");
    expect(result.comparison.message).toContain("fixture");
  });

  it("treats gate-eligible execution-profile drift as a typed non-gating comparison", () => {
    const executionProfile = observedVerifiedProfile();
    const result = assessAgainstBaseline(
      baseline(1, 1),
      candidate(0, 0, {
        executionProfile,
        runConfiguration: runConfiguration({
          executionProfile,
          fingerprint: "fingerprint-execution-b",
        }),
      }),
    );
    expect(result.status).toBe("non-gating");
    if (result.status !== "non-gating" || result.kind !== "run-configuration") {
      throw new Error("unreachable");
    }
    expect(result.reason).toBe("execution-profile-drift");
    expect(result.comparison.message).toContain("execution profile");
  });

  it("treats unavailable source identity as a typed non-gating comparison", () => {
    const result = assessAgainstBaseline(
      baseline(1, 1),
      candidate(0, 0, {
        runConfiguration: runConfiguration({
          sourceIdentity: {
            status: "unavailable",
            reason: "not-a-git-worktree",
            message: "not a git checkout",
          },
          fingerprint: "fingerprint-source-unavailable",
        }),
      }),
    );
    expect(result.status).toBe("non-gating");
    if (result.status !== "non-gating" || result.kind !== "run-configuration") {
      throw new Error("unreachable");
    }
    expect(result.reason).toBe("source-identity-unavailable");
  });

  it("treats a legacy baseline without runConfiguration as a fresh population", () => {
    const prior = baseline(1, 1);
    delete (prior as { runConfiguration?: EvalRunConfiguration }).runConfiguration;
    const result = assessAgainstBaseline(prior, candidate(1, 1));
    expect(result.status).toBe("non-gating");
    if (result.status !== "non-gating" || result.kind !== "run-configuration") {
      throw new Error("unreachable");
    }
    expect(result.reason).toBe("prior-run-configuration-unavailable");
  });
});
