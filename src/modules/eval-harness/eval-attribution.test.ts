import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DRIFTED_PROFILE,
  evidence,
  executionProfile,
  runConfiguration,
} from "./eval-attribution-test-data.js";
import {
  buildAttribution,
  writePriorReport,
} from "./eval-attribution-test-harness.js";

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

  it("reports comparable unchanged runs without changed components", () => {
    const prior = writePriorReport(priorDir);
    const attribution = buildAttribution(candidateDir, { prior });
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
      "tierEvidence=fast:gpt-5.6-luna,balanced:gpt-5.6-terra,capable:gpt-5.6-sol",
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
    const prior = writePriorReport(priorDir);
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
    const attribution = buildAttribution(candidateDir, { prior, config });

    expect(attribution.baseline.status).toBe("non-comparable");
    expect(attribution.baseline.reason).toBe("active-preset-drift");
    expect(attribution.baseline.changedComponents).toContain("model-preset");
  });

  it("attributes fixture manifest drift to fixture/verifier", () => {
    const prior = writePriorReport(priorDir);
    const config = runConfiguration({
      fixtureManifest: {
        fixtureCount: 2,
        hash: "fixture-hash-b",
        fixtures: [],
      },
      fingerprint: "fingerprint-fixture-b",
    });
    const attribution = buildAttribution(candidateDir, { prior, config });

    expect(attribution.baseline.reason).toBe("fixture-manifest-drift");
    expect(attribution.baseline.changedComponents).toContain("fixture-verifier");
  });

  it("surfaces verifier calibration changes as fixture/verifier diagnostic deltas", () => {
    const prior = writePriorReport(priorDir);
    const attribution = buildAttribution(candidateDir, {
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
    const prior = writePriorReport(priorDir);
    const execution = executionProfile(DRIFTED_PROFILE);
    const config = runConfiguration({
      resourceProfile: DRIFTED_PROFILE,
      executionProfile: execution,
      fingerprint: "fingerprint-resource-b",
    });
    const attribution = buildAttribution(candidateDir, {
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
    const prior = writePriorReport(priorDir);
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
    const attribution = buildAttribution(candidateDir, { prior, config });
    const model = attribution.components.find(
      (component) => component.id === "model-preset",
    );

    expect(model?.status).toBe("missing");
    expect(attribution.baseline.changedComponents).toContain("model-preset");
  });

  it("surfaces trajectory and context diagnostic deltas", () => {
    const prior = writePriorReport(priorDir);
    const attribution = buildAttribution(candidateDir, {
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
