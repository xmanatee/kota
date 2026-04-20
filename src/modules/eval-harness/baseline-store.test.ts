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

const sampleBaseline: PersistedBaseline = {
  aggregate: { fixtureCount: 3, repeatCount: 3, passAtK: 1, passHatK: 1 },
  resourceProfile: {
    hostClass: "autonomy-cadence",
    cpuAllocationCores: 2,
    cpuKillThresholdCores: 2,
    memoryAllocationMB: 4096,
    memoryKillThresholdMB: 4096,
  },
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
