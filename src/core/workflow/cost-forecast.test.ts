import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { getWorkflowCostForecast } from "./cost-forecast.js";

describe("getWorkflowCostForecast", () => {
  let kotaDir: string;

  beforeEach(() => {
    kotaDir = join(tmpdir(), `kota-forecast-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(kotaDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(kotaDir, { recursive: true, force: true });
  });

  it("returns forecast for a healthy baseline", () => {
    writeJsonFileAtomic(join(kotaDir, "cost-baseline.json"), {
      version: 1,
      baselines: {
        builder: {
          avgCostUsd: 2.5,
          runCount: 8,
          updatedAt: new Date().toISOString(),
        },
      },
    });

    const result = getWorkflowCostForecast(kotaDir, "builder");
    expect(result).not.toBeNull();
    expect(result!.workflow).toBe("builder");
    expect(result!.baselineAvgCostUsd).toBe(2.5);
    expect(result!.sampleSize).toBe(8);
    expect(result!.stale).toBe(false);
    expect(result!.confidence).toBe("high");
  });

  it("returns null for a workflow with no data", () => {
    writeJsonFileAtomic(join(kotaDir, "cost-baseline.json"), {
      version: 1,
      baselines: {},
    });

    const result = getWorkflowCostForecast(kotaDir, "nonexistent");
    expect(result).toBeNull();
  });

  it("returns null when baseline file does not exist", () => {
    const result = getWorkflowCostForecast(kotaDir, "builder");
    expect(result).toBeNull();
  });

  it("returns low confidence for a stale baseline", () => {
    const staleDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    writeJsonFileAtomic(join(kotaDir, "cost-baseline.json"), {
      version: 1,
      baselines: {
        builder: {
          avgCostUsd: 1.8,
          runCount: 10,
          updatedAt: staleDate,
        },
      },
    });

    const result = getWorkflowCostForecast(kotaDir, "builder");
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
    expect(result!.confidence).toBe("low");
    expect(result!.baselineAvgCostUsd).toBe(1.8);
  });

  it("returns low confidence when sample size is below threshold", () => {
    writeJsonFileAtomic(join(kotaDir, "cost-baseline.json"), {
      version: 1,
      baselines: {
        explorer: {
          avgCostUsd: 0.5,
          runCount: 2,
          updatedAt: new Date().toISOString(),
        },
      },
    });

    const result = getWorkflowCostForecast(kotaDir, "explorer");
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe("low");
    expect(result!.sampleSize).toBe(2);
  });
});
