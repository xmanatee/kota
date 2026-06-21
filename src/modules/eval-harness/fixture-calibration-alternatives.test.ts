import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

describe("loadFixture calibration alternatives", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixture-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts verifier calibration accepted alternatives with validated case ids", () => {
    writeFixture(root, "calibrationAlternative", {
      id: "calibrationAlternative",
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
      verifierCalibration: {
        null: {},
        golden: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/golden/result.txt",
              targetPath: "result.txt",
            },
          ],
        },
        acceptedAlternatives: [
          {
            id: "equivalent-output",
            setup: [
              {
                kind: "copy-fixture-file",
                sourcePath: "calibration/accepted-alternatives/equivalent-output/result.txt",
                targetPath: "result.txt",
              },
            ],
          },
        ],
        adversarial: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/adversarial/result.txt",
              targetPath: "result.txt",
            },
          ],
        },
      },
    });
    mkdirSync(join(root, "calibrationAlternative", "calibration", "golden"), {
      recursive: true,
    });
    mkdirSync(
      join(
        root,
        "calibrationAlternative",
        "calibration",
        "accepted-alternatives",
        "equivalent-output",
      ),
      { recursive: true },
    );
    mkdirSync(join(root, "calibrationAlternative", "calibration", "adversarial"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "calibrationAlternative", "calibration", "golden", "result.txt"),
      "ok",
    );
    writeFileSync(
      join(
        root,
        "calibrationAlternative",
        "calibration",
        "accepted-alternatives",
        "equivalent-output",
        "result.txt",
      ),
      "also ok",
    );
    writeFileSync(
      join(root, "calibrationAlternative", "calibration", "adversarial", "result.txt"),
      "bad",
    );

    const loaded = loadFixture(root, "calibrationAlternative");
    expect(loaded.spec.verifierCalibration?.cases.map((entry) => ({
      id: entry.id,
      caseKind: entry.caseKind,
      expected: entry.expected,
    }))).toEqual([
      { id: "null", caseKind: "null", expected: "fail" },
      { id: "golden", caseKind: "golden", expected: "pass" },
      {
        id: "equivalent-output",
        caseKind: "accepted-alternative",
        expected: "pass",
      },
      { id: "adversarial", caseKind: "adversarial", expected: "fail" },
    ]);
  });

  it("rejects malformed accepted alternative calibration declarations", () => {
    writeFixture(root, "badAlternativeCalibration", {
      id: "badAlternativeCalibration",
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
      verifierCalibration: {
        null: {},
        golden: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/golden/result.txt",
              targetPath: "result.txt",
            },
          ],
        },
        acceptedAlternatives: [
          {
            id: "golden",
            setup: [],
          },
        ],
        adversarial: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/adversarial/result.txt",
              targetPath: "result.txt",
            },
          ],
        },
      },
    });
    mkdirSync(join(root, "badAlternativeCalibration", "calibration", "golden"), {
      recursive: true,
    });
    mkdirSync(join(root, "badAlternativeCalibration", "calibration", "adversarial"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "badAlternativeCalibration", "calibration", "golden", "result.txt"),
      "ok",
    );
    writeFileSync(
      join(root, "badAlternativeCalibration", "calibration", "adversarial", "result.txt"),
      "bad",
    );

    let caught: unknown;
    try {
      loadFixture(root, "badAlternativeCalibration");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FixtureVerifierCalibrationError);
    expect((caught as Error).message).toContain("duplicates");
    expect((caught as Error).message).toContain("golden");
  });
});
