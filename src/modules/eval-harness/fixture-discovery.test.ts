import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isSingleWorkflowFixtureSpec,
  isSkillAblationFixtureSpec,
  loadAllFixtures,
} from "./fixture.js";
import {
  writeFixture,
} from "./fixture-test-support.js";
import { evaluatePredicateExpectations } from "./predicates.js";

describe("loadAllFixtures", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixture-all-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns an empty list when the fixtures root does not exist", () => {
    rmSync(root, { recursive: true });
    expect(loadAllFixtures(root)).toEqual([]);
  });

  it("discovers multiple fixtures and returns them sorted by id", () => {
    writeFixture(root, "beta", {
      id: "beta",
      description: "beta",
      role: "builder",
      workflowName: "builder",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
    });
    writeFixture(root, "alpha", {
      id: "alpha",
      description: "alpha",
      role: "decomposer",
      workflowName: "decomposer",
      budgetMs: 600_000,
      predicates: [{ kind: "file-exists", path: "x" }],
    });
    mkdirSync(join(root, "not-a-fixture"));
    writeFileSync(join(root, "note.md"), "ignore me");
    const ids = loadAllFixtures(root).map((f) => f.spec.id);
    expect(ids).toEqual(["alpha", "beta"]);
  });

  it("loads every shipped fixture with explicit pre-run expectations and control decisions", () => {
    const fixtures = loadAllFixtures(
      join(process.cwd(), "src/modules/eval-harness/fixtures"),
    );
    expect(fixtures.length).toBeGreaterThan(0);
    expect(
      fixtures.every((fixture) => {
        if (isSingleWorkflowFixtureSpec(fixture.spec)) {
          return fixture.spec.preRunExpectations.some(
            (expectation) => expectation.expected === "fail",
          );
        }
        if (isSkillAblationFixtureSpec(fixture.spec)) {
          return fixture.spec.variants.every((variant) =>
            variant.preRunExpectations.some(
              (expectation) => expectation.expected === "fail",
            ),
          );
        }
        return fixture.spec.rounds.every((round) =>
          round.preRunExpectations.some(
            (expectation) => expectation.expected === "fail",
          ),
        );
      }),
    ).toBe(true);
    expect(
      fixtures.every((fixture) => fixture.spec.controlDecisions.length > 0),
    ).toBe(true);
  });

  it("ships at least one smoke fixture with an objective metric and non-vacuous pre-run expectation", () => {
    const fixtures = loadAllFixtures(
      join(process.cwd(), "src/modules/eval-harness/fixtures"),
    );
    const demonstratingFixtures = fixtures.filter(
      (fixture) =>
        isSingleWorkflowFixtureSpec(fixture.spec) &&
        fixture.spec.provenance.kind === "smoke-fixture" &&
        (fixture.spec.objectiveMetrics?.length ?? 0) > 0 &&
        fixture.spec.preRunExpectations.some(
          (expectation) => expectation.expected === "fail",
        ),
    );
    expect(demonstratingFixtures.map((fixture) => fixture.spec.id)).toContain(
      "builder-trivial-edit",
    );
  });

  it("shipped fixture pre-run expectations match their initial trees", async () => {
    const fixtures = loadAllFixtures(
      join(process.cwd(), "src/modules/eval-harness/fixtures"),
    );
    const scratch = mkdtempSync(join(tmpdir(), "kota-shipped-pre-run-"));
    try {
      for (const fixture of fixtures) {
        const workDir = join(scratch, fixture.spec.id);
        cpSync(fixture.initialStateDir, workDir, { recursive: true });
        const expectationSets = isSingleWorkflowFixtureSpec(fixture.spec)
          ? [fixture.spec.preRunExpectations]
          : isSkillAblationFixtureSpec(fixture.spec)
            ? fixture.spec.variants.map((variant) => variant.preRunExpectations)
            : [fixture.spec.rounds[0].preRunExpectations];
        for (const expectations of expectationSets) {
          const result = await evaluatePredicateExpectations(
            workDir,
            expectations,
          );
          expect(
            result.results.filter((entry) => !entry.passed),
            fixture.spec.id,
          ).toEqual([]);
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
