import { join } from "node:path";
import {
  resolveDefaultEffort,
  resolveDefaultModel,
  resolvePreset,
  resolveTierModel,
} from "#core/model/preset.js";
import type {
  EvalComponentAttribution,
  EvalFixtureRunAttributionEvidence,
} from "./eval-attribution.js";
import type {
  ExecutionProfilePreflightResult,
  FixtureRun,
  ResourceProfile,
} from "./fixture-run.js";
import { OFFLINE_CONTAINER_NETWORK_POLICY } from "./provider-egress.js";
import type { EvalRunConfiguration } from "./run-configuration.js";
import type { FixtureDiagnostics, FixtureDiagnosticsReport } from "./scoring.js";

export const PROFILE: ResourceProfile = {
  hostClass: "test",
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4096,
  memoryKillThresholdMB: 4096,
};

export const DRIFTED_PROFILE: ResourceProfile = {
  ...PROFILE,
  cpuKillThresholdCores: 4,
};

function defaultActivePreset(): EvalRunConfiguration["components"]["activePreset"] {
  const { preset, source } = resolvePreset({});
  return {
    id: preset.id,
    source,
    harness: preset.harness,
    defaultModel: resolveDefaultModel(preset),
    defaultEffort: resolveDefaultEffort(preset),
    tiers: {
      fast: resolveTierModel(preset, "fast"),
      balanced: resolveTierModel(preset, "balanced"),
      capable: resolveTierModel(preset, "capable"),
    },
  };
}

export function executionProfile(
  profile: ResourceProfile = PROFILE,
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

export function runConfiguration(
  overrides: Partial<EvalRunConfiguration["components"]> & {
    fingerprint?: string;
  } = {},
): EvalRunConfiguration {
  const { fingerprint, ...componentOverrides } = overrides;
  const activePreset = defaultActivePreset();
  const components: EvalRunConfiguration["components"] = {
    activePreset,
    fixtureManifest: {
      fixtureCount: 1,
      hash: "fixture-hash-a",
      fixtures: [
        {
          id: "alpha",
          mode: "single-workflow",
          role: "builder",
          workflowNames: ["builder"],
          specHash: "spec-a",
        },
      ],
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
        {
          harness: activePreset.harness,
          model: activePreset.defaultModel,
          count: 1,
        },
      ],
    },
    resourceProfile: PROFILE,
    executionProfile: executionProfile(),
    ...componentOverrides,
  };
  return {
    fingerprint: fingerprint ?? "fingerprint-a",
    summary: {
      activePreset: `${components.activePreset.id} (${components.activePreset.source}) via ${components.activePreset.harness}`,
      fixtureManifest: `${components.fixtureManifest.fixtureCount} fixture(s) ${components.fixtureManifest.hash}`,
      sourceIdentity:
        components.sourceIdentity.status === "available"
          ? components.sourceIdentity.headSha.slice(0, 12)
          : `unavailable:${components.sourceIdentity.reason}`,
      resolvedHarnessModelEvidence:
        components.resolvedHarnessModelEvidence.distinctHarnessModels
          .map((pair) => `${pair.harness}/${pair.model} x${pair.count}`)
          .join(", ") || components.resolvedHarnessModelEvidence.status,
      resourceProfile: `${components.resourceProfile.hostClass} cpu=${components.resourceProfile.cpuAllocationCores}/${components.resourceProfile.cpuKillThresholdCores} memoryMB=${components.resourceProfile.memoryAllocationMB}/${components.resourceProfile.memoryKillThresholdMB}`,
      executionProfile: `${components.executionProfile.status}/${components.executionProfile.backendKind}/${components.executionProfile.verification}/verified-profile`,
    },
    components,
  };
}

export function diagnostic(
  fixtureId: string,
  outcomes: FixtureRun["outcome"][] = ["pass", "pass", "pass"],
  warnings: FixtureDiagnostics["warnings"] = [],
): FixtureDiagnostics {
  const passes = outcomes.filter((outcome) => outcome === "pass").length;
  return {
    fixtureId,
    repeatCount: outcomes.length,
    outcomes,
    outcomeCounts: {
      pass: passes,
      fail: outcomes.filter((outcome) => outcome === "fail").length,
      timeout: outcomes.filter((outcome) => outcome === "timeout").length,
      error: outcomes.filter((outcome) => outcome === "error").length,
      "configuration-error": outcomes.filter(
        (outcome) => outcome === "configuration-error",
      ).length,
    },
    observedPassRate: passes / outcomes.length,
    repeatVariance: 0,
    diagnosticClass:
      passes === outcomes.length
        ? "stable-pass"
        : passes === 0
          ? "stable-fail"
          : "repeat-unstable",
    warnings,
  };
}

export function diagnosticsReport(
  entry: FixtureDiagnostics = diagnostic("alpha"),
): FixtureDiagnosticsReport {
  return {
    perFixture: [entry],
    aggregate: {
      fixtureCount: 1,
      stablePass: entry.diagnosticClass === "stable-pass" ? 1 : 0,
      stableFail: entry.diagnosticClass === "stable-fail" ? 1 : 0,
      repeatUnstable: entry.diagnosticClass === "repeat-unstable" ? 1 : 0,
      insufficientSample: 0,
      nonGating: 0,
      lowSignalWarnings: entry.warnings.includes("low-signal-repeat-instability")
        ? 1
        : 0,
    },
  };
}

export function fixtureRun(
  config: EvalRunConfiguration = runConfiguration(),
): FixtureRun {
  return {
    fixtureId: "alpha",
    runIndex: 0,
    repeatCount: 3,
    outcome: "pass",
    resourceProfile: config.components.resourceProfile,
    executionProfile: config.components.executionProfile,
    objectiveMetrics: [],
    timing: {
      startedAt: "2026-04-27T12:00:00.000Z",
      durationMs: 10,
      budgetMs: 60_000,
    },
    runArtifactPath: "/tmp/eval-run/alpha-0",
  };
}

export function emptyDiagnostic() {
  return {
    status: "missing" as const,
    artifactCount: 0,
    warningCount: 0,
    codes: [],
  };
}

export function evidence(
  overrides: Partial<EvalFixtureRunAttributionEvidence> = {},
): EvalFixtureRunAttributionEvidence {
  return {
    fixtureId: "alpha",
    runIndex: 0,
    childRunArtifactCount: 1,
    predicateCount: 1,
    failedPredicateCount: 0,
    predicateKinds: ["file-exists"],
    verifierCalibration: emptyDiagnostic(),
    trajectoryDiagnostics: emptyDiagnostic(),
    contextRetrievalDiagnostics: emptyDiagnostic(),
    ...overrides,
  };
}

export function codeHealth() {
  return {
    diagnosticRunCount: 0,
    runsWithWarnings: 0,
    fixturesWithWarnings: 0,
    totalWarnings: 0,
    warningCounts: {
      "source-size-growth": 0,
      "duplicated-implementation-chunk": 0,
      "complexity-concentration": 0,
    },
  };
}

export function componentAttribution(
  candidateRunArtifactBaseDir: string,
  overrides: Partial<EvalComponentAttribution> = {},
): EvalComponentAttribution {
  return {
    schemaVersion: 1,
    summary: "component attribution: comparable eval population with no observed component or fixture outcome deltas",
    artifactPath: join(candidateRunArtifactBaseDir, "eval-set-report.json"),
    baseline: {
      status: "comparable",
      reason: null,
      priorRunArtifactBaseDir: null,
      candidateRunArtifactBaseDir,
      changedComponents: [],
    },
    components: [],
    diagnostics: {
      verifierCalibration: emptyDiagnostic(),
      trajectoryDiagnostics: emptyDiagnostic(),
      contextRetrievalDiagnostics: emptyDiagnostic(),
    },
    perFixture: [
      {
        fixtureId: "alpha",
        outcomeDelta: "unchanged",
        diagnosticDelta: "unchanged",
        prior: null,
        candidate: {
          outcomes: ["pass", "pass", "pass"],
          observedPassRate: 1,
          diagnosticClass: "stable-pass",
          warnings: [],
        },
        addedWarnings: [],
        removedWarnings: [],
        artifactEvidence: {
          runCount: 1,
          childRunArtifactCount: 1,
          predicateCount: 1,
          failedPredicateCount: 0,
          predicateKinds: ["file-exists"],
          verifierCalibration: emptyDiagnostic(),
          trajectoryDiagnostics: emptyDiagnostic(),
          contextRetrievalDiagnostics: emptyDiagnostic(),
        },
        objectiveMetricDeltas: [],
      },
    ],
    ...overrides,
  };
}
