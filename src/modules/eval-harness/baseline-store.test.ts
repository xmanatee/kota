import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  baselineFilePath,
  loadBaseline,
  type PersistedBaseline,
  saveBaseline,
} from "./baseline-store.js";
import type { EvalRunConfiguration } from "./run-configuration.js";

const sampleRunConfiguration: EvalRunConfiguration = {
  fingerprint: "fingerprint-a",
  summary: {
    activePreset: "codex (default) via codex",
    fixtureManifest: "3 fixture(s) fixture-hash",
    sourceIdentity: "abc123 (clean, source-hash)",
    resolvedHarnessModelEvidence: "codex/gpt-5.5 x3",
    resourceProfile: "autonomy-cadence cpu=2/2 memoryMB=4096/4096",
    executionProfile: "verified/container/enforced/verified-profile",
  },
  components: {
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
      fixtureCount: 3,
      hash: "fixture-hash",
      fixtures: [],
    },
    sourceIdentity: {
      status: "available",
      headSha: "a".repeat(40),
      dirty: false,
      statusHash: "status-hash",
      sourceHash: "source-hash",
    },
    resolvedHarnessModelEvidence: {
      status: "complete",
      observations: [],
      missingArtifacts: [],
      distinctHarnessModels: [
        { harness: "codex", model: "gpt-5.5", count: 3 },
      ],
    },
    resourceProfile: {
      hostClass: "autonomy-cadence",
      cpuAllocationCores: 2,
      cpuKillThresholdCores: 2,
      memoryAllocationMB: 4096,
      memoryKillThresholdMB: 4096,
    },
    executionProfile: {
      status: "verified",
      backendKind: "container",
      requestedProfile: {
        hostClass: "autonomy-cadence",
        cpuAllocationCores: 2,
        cpuKillThresholdCores: 2,
        memoryAllocationMB: 4096,
        memoryKillThresholdMB: 4096,
      },
      observedOrEnforcedProfile: {
        hostClass: "autonomy-cadence",
        cpuAllocationCores: 2,
        cpuKillThresholdCores: 2,
        memoryAllocationMB: 4096,
        memoryKillThresholdMB: 4096,
      },
      verification: "enforced",
      gateEligible: true,
      eligibilityReason: "verified-profile",
      diagnostics: [],
    },
  },
};

const sampleBaseline: PersistedBaseline = {
  aggregate: { fixtureCount: 3, repeatCount: 3, passAtK: 1, passHatK: 1 },
  resourceProfile: {
    hostClass: "autonomy-cadence",
    cpuAllocationCores: 2,
    cpuKillThresholdCores: 2,
    memoryAllocationMB: 4096,
    memoryKillThresholdMB: 4096,
  },
  runConfiguration: sampleRunConfiguration,
  recordedAt: "2026-04-20T12:00:00.000Z",
  runArtifactBaseDir: "/tmp/example/eval-runs",
};

describe("baseline-store", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-baseline-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns null when no baseline exists", () => {
    expect(loadBaseline(projectDir)).toBeNull();
  });

  it("writes baseline under .kota/eval-harness/baseline.json and round-trips", () => {
    saveBaseline(projectDir, sampleBaseline);
    expect(existsSync(baselineFilePath(projectDir))).toBe(true);
    expect(baselineFilePath(projectDir)).toBe(
      join(projectDir, ".kota", "eval-harness", "baseline.json"),
    );
    expect(loadBaseline(projectDir)).toEqual(sampleBaseline);
  });

  it("overwrites the prior baseline when saved again", () => {
    saveBaseline(projectDir, sampleBaseline);
    const next: PersistedBaseline = {
      ...sampleBaseline,
      aggregate: { ...sampleBaseline.aggregate, passHatK: 0.9 },
      recordedAt: "2026-04-27T12:00:00.000Z",
    };
    saveBaseline(projectDir, next);
    expect(loadBaseline(projectDir)).toEqual(next);
  });
});
