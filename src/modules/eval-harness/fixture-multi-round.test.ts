import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isMultiRoundFixtureSpec,
  loadFixture,
} from "./fixture.js";
import {
  writeFixture,
} from "./fixture-test-support.js";

describe("loadFixture multi-round specs", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixture-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts a well-formed multi-round fixture with explicit round inputs", () => {
    writeFixture(root, "multi", {
      id: "multi",
      description: "persistent rounds",
      role: "builder",
      mode: "multi-round",
      rounds: [
        {
          id: "round-1",
          workflowName: "builder",
          budgetMs: 600_000,
          taskInput: { kind: "initial-state" },
          preRunExpectations: [
            { predicate: { kind: "file-exists", path: "round-1.txt" }, expected: "fail" },
          ],
          predicates: [{ kind: "file-exists", path: "round-1.txt" }],
        },
        {
          id: "round-2",
          workflowName: "builder",
          budgetMs: 600_000,
          taskInput: {
            kind: "copy-fixture-file",
            sourcePath: "rounds/round-2-task.md",
            targetPath: "data/tasks/task-round-2.md",
          },
          preRunExpectations: [
            { predicate: { kind: "file-exists", path: "round-2.txt" }, expected: "fail" },
          ],
          predicates: [
            { kind: "file-exists", path: "round-1.txt" },
            { kind: "file-exists", path: "round-2.txt" },
          ],
          objectiveMetrics: [
            {
              name: "round_2_score",
              unit: "ratio",
              direction: "higher_is_better",
              source: { kind: "text-file", path: "round-2-score.txt" },
            },
          ],
        },
      ],
      aggregatePredicates: [{ kind: "file-exists", path: "round-2.txt" }],
      aggregateObjectiveMetrics: [
        {
          name: "final_score",
          unit: "ratio",
          direction: "higher_is_better",
          source: { kind: "text-file", path: "final-score.txt" },
        },
      ],
      verifierCalibration: {
        null: {},
        golden: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/golden/round-2-score.txt",
              targetPath: "round-2-score.txt",
            },
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/golden/final-score.txt",
              targetPath: "final-score.txt",
            },
          ],
        },
        adversarial: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/adversarial/round-2-score.txt",
              targetPath: "round-2-score.txt",
            },
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/adversarial/final-score.txt",
              targetPath: "final-score.txt",
            },
          ],
        },
      },
    });
    mkdirSync(join(root, "multi", "rounds"), { recursive: true });
    writeFileSync(join(root, "multi", "rounds", "round-2-task.md"), "round 2");
    mkdirSync(join(root, "multi", "calibration", "golden"), { recursive: true });
    mkdirSync(join(root, "multi", "calibration", "adversarial"), {
      recursive: true,
    });
    writeFileSync(join(root, "multi", "calibration", "golden", "round-2-score.txt"), "2");
    writeFileSync(join(root, "multi", "calibration", "golden", "final-score.txt"), "2");
    writeFileSync(
      join(root, "multi", "calibration", "adversarial", "round-2-score.txt"),
      "1",
    );
    writeFileSync(
      join(root, "multi", "calibration", "adversarial", "final-score.txt"),
      "1",
    );

    const loaded = loadFixture(root, "multi");
    expect(isMultiRoundFixtureSpec(loaded.spec)).toBe(true);
    if (!isMultiRoundFixtureSpec(loaded.spec)) throw new Error("expected multi");
    expect(loaded.spec.rounds.map((round) => round.id)).toEqual([
      "round-1",
      "round-2",
    ]);
    expect(loaded.spec.rounds[1].taskInput).toMatchObject({
      kind: "copy-fixture-file",
      targetPath: "data/tasks/task-round-2.md",
    });
    expect(loaded.spec.aggregatePredicates).toHaveLength(1);
    expect(loaded.spec.aggregateObjectiveMetrics).toHaveLength(1);
  });

  it("rejects malformed multi-round specs loudly", () => {
    writeFixture(root, "emptyRounds", {
      id: "emptyRounds",
      description: "x",
      role: "builder",
      mode: "multi-round",
      rounds: [],
    });
    expect(() => loadFixture(root, "emptyRounds")).toThrow(/non-empty rounds/);

    writeFixture(root, "mixedMode", {
      id: "mixedMode",
      description: "x",
      role: "builder",
      mode: "multi-round",
      workflowName: "builder",
      rounds: [
        {
          id: "round-1",
          workflowName: "builder",
          budgetMs: 600_000,
          taskInput: { kind: "initial-state" },
          preRunExpectations: [
            { predicate: { kind: "file-exists", path: "x" }, expected: "fail" },
          ],
          predicates: [{ kind: "file-exists", path: "x" }],
        },
      ],
    });
    expect(() => loadFixture(root, "mixedMode")).toThrow(/cannot declare workflowName/);

    writeFixture(root, "badRoundInput", {
      id: "badRoundInput",
      description: "x",
      role: "builder",
      mode: "multi-round",
      rounds: [
        {
          id: "round-1",
          workflowName: "builder",
          budgetMs: 600_000,
          taskInput: { kind: "copy-fixture-file", sourcePath: "x" },
          preRunExpectations: [
            { predicate: { kind: "file-exists", path: "x" }, expected: "fail" },
          ],
          predicates: [{ kind: "file-exists", path: "x" }],
        },
      ],
    });
    expect(() => loadFixture(root, "badRoundInput")).toThrow(/taskInput/);
  });
});
