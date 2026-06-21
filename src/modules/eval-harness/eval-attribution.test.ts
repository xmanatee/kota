import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PersistedBaseline } from "./baseline-store.js";
import {
  buildEvalComponentAttribution,
  type EvalComponentAttribution,
  type EvalFixtureRunAttributionEvidence,
} from "./eval-attribution.js";
import type {
  ExecutionProfilePreflightResult,
  FixtureRun,
  ResourceProfile,
} from "./fixture-run.js";
import { OFFLINE_CONTAINER_NETWORK_POLICY } from "./provider-egress.js";
import type { EvalRunConfiguration } from "./run-configuration.js";
import type { FixtureDiagnostics, FixtureDiagnosticsReport } from "./scoring.js";

const PROFILE: ResourceProfile = {
  hostClass: "test",
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4096,
  memoryKillThresholdMB: 4096,
};

const DRIFTED_PROFILE: ResourceProfile = {
  ...PROFILE,
  cpuKillThresholdCores: 4,
};

function executionProfile(
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
        { harness: "codex", model: "gpt-5.5", count: 1 },
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

function diagnostic(
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

function diagnosticsReport(
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

function fixtureRun(
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

function emptyDiagnostic() {
  return {
    status: "missing" as const,
    artifactCount: 0,
    warningCount: 0,
    codes: [],
  };
}

function evidence(
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

function codeHealth() {
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

function componentAttribution(
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

describe("eval component attribution", () => {
  let priorDir: string;
  let candidateDir: string;

  beforeEach(() => {
    priorDir = mkdtempSync(join(tmpdir(), "kota-eval-prior-"));
    candidateDir = mkdtempSync(join(tmpdir(), "kota-eval-candidate-"));
  });

  afterEach(() => {
    rmSync(priorDir, { recursive: true, force: true });
    rmSync(candidateDir, { recursive: true, force: true });
  });

  function writePriorReport(params: {
    config?: EvalRunConfiguration;
    profile?: ResourceProfile;
    execution?: ExecutionProfilePreflightResult;
    diagnostics?: FixtureDiagnosticsReport;
    attribution?: EvalComponentAttribution;
  } = {}): PersistedBaseline {
    const config = params.config ?? runConfiguration();
    const report = {
      perFixture: [
        {
          fixtureId: "alpha",
          repeatCount: 3,
          passedAny: true,
          passedAll: true,
          observedPassRate: 1,
        },
      ],
      fixtureDiagnostics: params.diagnostics ?? diagnosticsReport(),
      objectiveMetrics: [],
      codeHealth: codeHealth(),
      runConfiguration: config,
      resourceProfile: params.profile ?? config.components.resourceProfile,
      executionProfile: params.execution ?? config.components.executionProfile,
      componentAttribution:
        params.attribution ?? componentAttribution(priorDir),
    };
    mkdirSync(priorDir, { recursive: true });
    writeFileSync(
      join(priorDir, "eval-set-report.json"),
      JSON.stringify(report, null, 2),
    );
    return {
      aggregate: {
        fixtureCount: 1,
        repeatCount: 3,
        passAtK: 1,
        passHatK: 1,
      },
      resourceProfile: report.resourceProfile,
      runConfiguration: config,
      recordedAt: "2026-04-20T12:00:00.000Z",
      runArtifactBaseDir: priorDir,
    };
  }

  function build(params: {
    prior?: PersistedBaseline | null;
    config?: EvalRunConfiguration;
    profile?: ResourceProfile;
    execution?: ExecutionProfilePreflightResult;
    diagnostics?: FixtureDiagnosticsReport;
    evidence?: readonly EvalFixtureRunAttributionEvidence[];
  } = {}) {
    const config = params.config ?? runConfiguration();
    const execution = params.execution ?? config.components.executionProfile;
    return buildEvalComponentAttribution({
      priorBaseline: params.prior ?? null,
      runs: [fixtureRun(config)],
      perFixture: [
        {
          fixtureId: "alpha",
          repeatCount: 3,
          passedAny: true,
          passedAll: true,
          observedPassRate: 1,
        },
      ],
      fixtureDiagnostics: params.diagnostics ?? diagnosticsReport(),
      objectiveMetrics: [],
      codeHealth: codeHealth(),
      runConfiguration: config,
      resourceProfile: params.profile ?? config.components.resourceProfile,
      executionProfile: execution,
      repeatCount: 3,
      runArtifactBaseDir: candidateDir,
      runArtifactEvidence: params.evidence ?? [evidence()],
    });
  }

  it("reports comparable unchanged runs without changed components", () => {
    const prior = writePriorReport();
    const attribution = build({ prior });
    const model = attribution.components.find(
      (component) => component.id === "model-preset",
    );
    const harness = attribution.components.find(
      (component) => component.id === "harness-execution",
    );
    const environment = attribution.components.find(
      (component) => component.id === "environment-resource",
    );

    expect(attribution.baseline.status).toBe("comparable");
    expect(attribution.baseline.changedComponents).toEqual([]);
    expect(attribution.summary).toContain("no observed component");
    expect(attribution.perFixture[0]?.outcomeDelta).toBe("unchanged");
    expect(model?.evidence).toContain(
      "tierEvidence=fast:gpt-5.4-mini,balanced:gpt-5.4,capable:gpt-5.5",
    );
    expect(harness?.evidence).toContain("executionMode=live");
    expect(environment?.evidence).toContain(
      "timeoutEnvelope=runs=1,budgetMs=60000,maxDurationMs=10,deadlineHits=0,cleanReturns=1",
    );
    expect(environment?.evidence).toContain(
      "networkPolicy=offline/docker-network-none/endpoints=none/gateEligible=true",
    );
  });

  it("attributes preset and model drift to the model component", () => {
    const prior = writePriorReport();
    const config = runConfiguration({
      activePreset: {
        id: "claude",
        source: "env",
        harness: "claude-agent-sdk",
        defaultModel: "claude-opus-4-7",
        defaultEffort: "xhigh",
        tiers: {
          fast: "claude-haiku-4-5-20251001",
          balanced: "claude-sonnet-4-6",
          capable: "claude-opus-4-7",
        },
      },
      resolvedHarnessModelEvidence: {
        status: "complete",
        observations: [],
        missingArtifacts: [],
        distinctHarnessModels: [
          { harness: "claude-agent-sdk", model: "claude-opus-4-7", count: 1 },
        ],
      },
      fingerprint: "fingerprint-model-b",
    });
    const attribution = build({ prior, config });

    expect(attribution.baseline.status).toBe("non-comparable");
    expect(attribution.baseline.reason).toBe("active-preset-drift");
    expect(attribution.baseline.changedComponents).toContain("model-preset");
  });

  it("attributes fixture manifest drift to fixture/verifier", () => {
    const prior = writePriorReport();
    const config = runConfiguration({
      fixtureManifest: {
        fixtureCount: 2,
        hash: "fixture-hash-b",
        fixtures: [],
      },
      fingerprint: "fingerprint-fixture-b",
    });
    const attribution = build({ prior, config });

    expect(attribution.baseline.reason).toBe("fixture-manifest-drift");
    expect(attribution.baseline.changedComponents).toContain("fixture-verifier");
  });

  it("surfaces verifier calibration changes as fixture/verifier diagnostic deltas", () => {
    const prior = writePriorReport();
    const attribution = build({
      prior,
      evidence: [
        evidence({
          verifierCalibration: {
            status: "present",
            artifactCount: 1,
            warningCount: 1,
            codes: [{ code: "case:golden", count: 1 }],
          },
        }),
      ],
    });
    const entry = attribution.components.find(
      (component) => component.id === "fixture-verifier",
    );

    expect(entry?.status).toBe("diagnostic-delta");
    expect(attribution.perFixture[0]?.diagnosticDelta).toBe("changed");
    expect(attribution.baseline.changedComponents).toContain("fixture-verifier");
  });

  it("surfaces resource-profile drift as environment/resource change", () => {
    const prior = writePriorReport();
    const execution = executionProfile(DRIFTED_PROFILE);
    const config = runConfiguration({
      resourceProfile: DRIFTED_PROFILE,
      executionProfile: execution,
      fingerprint: "fingerprint-resource-b",
    });
    const attribution = build({
      prior,
      config,
      profile: DRIFTED_PROFILE,
      execution,
    });

    expect(attribution.baseline.changedComponents).toContain(
      "environment-resource",
    );
  });

  it("marks missing child run metadata as missing model evidence", () => {
    const prior = writePriorReport();
    const config = runConfiguration({
      resolvedHarnessModelEvidence: {
        status: "missing",
        observations: [],
        missingArtifacts: [
          {
            fixtureId: "alpha",
            runIndex: 0,
            workflowName: "builder",
            reason: "metadata-missing",
          },
        ],
        distinctHarnessModels: [],
      },
      fingerprint: "fingerprint-missing-metadata",
    });
    const attribution = build({ prior, config });
    const model = attribution.components.find(
      (component) => component.id === "model-preset",
    );

    expect(model?.status).toBe("missing");
    expect(attribution.baseline.changedComponents).toContain("model-preset");
  });

  it("surfaces trajectory and context diagnostic deltas", () => {
    const prior = writePriorReport();
    const attribution = build({
      prior,
      evidence: [
        evidence({
          trajectoryDiagnostics: {
            status: "present",
            artifactCount: 1,
            warningCount: 1,
            codes: [
              { code: "missing_final_verification_after_edit", count: 1 },
            ],
          },
          contextRetrievalDiagnostics: {
            status: "present",
            artifactCount: 1,
            warningCount: 1,
            codes: [{ code: "missed_retrieval_target", count: 1 }],
          },
        }),
      ],
    });
    const feedback = attribution.components.find(
      (component) => component.id === "feedback-loop",
    );
    const prompt = attribution.components.find(
      (component) => component.id === "prompt-skill-context",
    );

    expect(feedback?.status).toBe("diagnostic-delta");
    expect(prompt?.status).toBe("diagnostic-delta");
    expect(attribution.perFixture[0]?.diagnosticDelta).toBe("changed");
    expect(attribution.baseline.changedComponents).toContain("feedback-loop");
    expect(attribution.baseline.changedComponents).toContain(
      "prompt-skill-context",
    );
  });
});
