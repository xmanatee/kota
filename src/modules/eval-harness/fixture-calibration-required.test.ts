import { mkdtempSync, rmSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FixtureVerifierCalibrationError,
  loadFixture,
} from "./fixture.js";
import {
  writeFixture,
} from "./fixture-test-support.js";

describe("loadFixture calibration requirements", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixture-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a custom-scored fixture that omits required verifier calibration", () => {
    writeFixture(root, "missingCalibration", {
      id: "missingCalibration",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [
        {
          kind: "lx12-scientific-claim-result",
          mainPath: "claim-result.json",
          holdoutPath: "claim-holdout-result.json",
          maxErrorPct: 0.000001,
        },
      ],
    });
    let caught: unknown;
    try {
      loadFixture(root, "missingCalibration");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FixtureVerifierCalibrationError);
    expect((caught as FixtureVerifierCalibrationError).reason).toBe(
      "missing-required",
    );
  });

  it("rejects a shell-scored fixture that omits required verifier calibration", () => {
    writeFixture(root, "missingShellCalibration", {
      id: "missingShellCalibration",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [
        {
          kind: "shell-succeeds",
          command: "test -f result.txt",
          timeoutMs: 10_000,
        },
      ],
    });
    let caught: unknown;
    try {
      loadFixture(root, "missingShellCalibration");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FixtureVerifierCalibrationError);
    expect((caught as Error).message).toContain("shell-succeeds");
  });

  it("rejects an objective-metric fixture that omits required verifier calibration", () => {
    writeFixture(root, "missingMetricCalibration", {
      id: "missingMetricCalibration",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "result.txt" }],
      objectiveMetrics: [
        {
          name: "result_score",
          unit: "points",
          direction: "higher_is_better",
          source: { kind: "text-file", path: "score.txt" },
        },
      ],
    });
    let caught: unknown;
    try {
      loadFixture(root, "missingMetricCalibration");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FixtureVerifierCalibrationError);
    expect((caught as Error).message).toContain("result_score");
  });

  it("rejects malformed verifier calibration cases with fixture-specific errors", () => {
    writeFixture(root, "badCalibration", {
      id: "badCalibration",
      description: "x",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [
        {
          kind: "lx12-scientific-claim-result",
          mainPath: "claim-result.json",
          holdoutPath: "claim-holdout-result.json",
          maxErrorPct: 0.000001,
        },
      ],
      verifierCalibration: {
        null: {},
        golden: { setup: [] },
        adversarial: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "../outside.json",
              targetPath: "claim-result.json",
            },
          ],
        },
      },
    });
    let caught: unknown;
    try {
      loadFixture(root, "badCalibration");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FixtureVerifierCalibrationError);
    expect((caught as FixtureVerifierCalibrationError).reason).toBe(
      "malformed-declaration",
    );
    expect((caught as Error).message).toContain("golden");
  });
});
