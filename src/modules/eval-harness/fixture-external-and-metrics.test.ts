import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadFixture,
} from "./fixture.js";
import {
  singleSpec,
  writeFixture,
} from "./fixture-test-support.js";
import { ObjectiveMetricValidationError } from "./objective-metrics.js";

describe("loadFixture external shims and metrics", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixture-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts an optional externalCallShims list and validates entry shape", () => {
    writeFixture(root, "withShims", {
      id: "withShims",
      description: "x",
      role: "pr-reviewer",
      workflowName: "pr-reviewer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      externalCallShims: ["gh"],
    });
    const loaded = loadFixture(root, "withShims");
    expect(loaded.spec.externalCallShims).toEqual(["gh"]);
  });

  it("rejects externalCallShims entries with unsafe characters", () => {
    writeFixture(root, "badShims", {
      id: "badShims",
      description: "x",
      role: "pr-reviewer",
      workflowName: "pr-reviewer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      externalCallShims: ["../escape"],
    });
    expect(() => loadFixture(root, "badShims")).toThrow(/externalCallShims/);
  });

  it("accepts typed objective metric declarations", () => {
    writeFixture(root, "withMetric", {
      id: "withMetric",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      objectiveMetrics: [
        {
          name: "output_size",
          unit: "bytes",
          direction: "lower_is_better",
          source: {
            kind: "json-file",
            path: "metrics.json",
            pointer: "/output/bytes",
          },
          comparisonBaseline: {
            value: 120,
            resourceProfile: {
              cpuAllocationCores: 2,
              cpuKillThresholdCores: 2,
              memoryAllocationMB: 4000,
              memoryKillThresholdMB: 4000,
              hostClass: "test",
            },
            executionProfile: {
              status: "verified",
              backendKind: "container",
              verification: "enforced",
              gateEligible: true,
            },
          },
        },
      ],
      verifierCalibration: {
        null: {},
        golden: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/golden/metrics.json",
              targetPath: "metrics.json",
            },
          ],
        },
        adversarial: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/adversarial/metrics.json",
              targetPath: "metrics.json",
            },
          ],
        },
      },
    });
    mkdirSync(join(root, "withMetric", "calibration", "golden"), {
      recursive: true,
    });
    mkdirSync(join(root, "withMetric", "calibration", "adversarial"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "withMetric", "calibration", "golden", "metrics.json"),
      JSON.stringify({ output: { bytes: 10 } }),
    );
    writeFileSync(
      join(root, "withMetric", "calibration", "adversarial", "metrics.json"),
      JSON.stringify({ output: { bytes: 20 } }),
    );
    const loaded = loadFixture(root, "withMetric");
    expect(singleSpec(loaded).objectiveMetrics).toEqual([
      {
        name: "output_size",
        unit: "bytes",
        direction: "lower_is_better",
        source: {
          kind: "json-file",
          path: "metrics.json",
          pointer: "/output/bytes",
        },
        comparisonBaseline: {
          value: 120,
          resourceProfile: {
            cpuAllocationCores: 2,
            cpuKillThresholdCores: 2,
            memoryAllocationMB: 4000,
            memoryKillThresholdMB: 4000,
            hostClass: "test",
          },
          executionProfile: {
            status: "verified",
            backendKind: "container",
            verification: "enforced",
            gateEligible: true,
          },
        },
      },
    ]);
  });

  it("rejects malformed objective metric declarations with a typed validation error", () => {
    writeFixture(root, "badMetric", {
      id: "badMetric",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      objectiveMetrics: [
        {
          name: "bad metric",
          unit: "bytes",
          direction: "lower",
          source: { kind: "text-file", path: "metric.txt" },
        },
      ],
    });
    let caught: unknown;
    try {
      loadFixture(root, "badMetric");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ObjectiveMetricValidationError);
    expect((caught as ObjectiveMetricValidationError).reason).toBe(
      "malformed-declaration",
    );
  });

  it("rejects objective metric baselines without comparable environment data", () => {
    writeFixture(root, "badMetricBaseline", {
      id: "badMetricBaseline",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "foo" }],
      objectiveMetrics: [
        {
          name: "duration",
          unit: "ms",
          direction: "lower_is_better",
          source: { kind: "text-file", path: "metric.txt" },
          comparisonBaseline: {
            value: 10,
            resourceProfile: {
              cpuAllocationCores: 2,
              cpuKillThresholdCores: 2,
              memoryAllocationMB: 4000,
              memoryKillThresholdMB: 4000,
              hostClass: "test",
            },
            executionProfile: {
              status: "non-gating",
              backendKind: "host-subprocess",
              verification: "unverified",
              gateEligible: false,
            },
          },
        },
      ],
    });
    let caught: unknown;
    try {
      loadFixture(root, "badMetricBaseline");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ObjectiveMetricValidationError);
    expect((caught as ObjectiveMetricValidationError).reason).toBe(
      "environment-incomparable",
    );
  });
});
