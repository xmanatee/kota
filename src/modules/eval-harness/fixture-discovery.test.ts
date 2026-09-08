import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveExecutableVerifierSandbox } from "./executable-verifier-sandbox.js";
import {
  isSingleWorkflowFixtureSpec,
  loadAllFixtures,
} from "./fixture.js";
import { fixtureScoringContext } from "./fixture-scoring-context.js";
import {
  writeFixture,
} from "./fixture-test-support.js";
import { evaluatePredicateExpectations } from "./predicates.js";
import { copyFixtureInitialState } from "./runner-materialize.js";
import { TEST_EXECUTION_PROFILE } from "./runner-test-profiles.js";
import { writeFakeContainerBackend } from "./subprocess-executor-test-helpers.js";

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

  it("shipped fixture pre-run expectations match their initial trees", async () => {
    const fixtures = loadAllFixtures(
      join(process.cwd(), "src/modules/eval-harness/fixtures"),
    );
    const scratch = mkdtempSync(join(tmpdir(), "kota-shipped-pre-run-"));
    const fakeContainer = join(scratch, "fake-container.mjs");
    writeFakeContainerBackend(fakeContainer);
    const capabilities = {
      executableVerifierSandbox: resolveExecutableVerifierSandbox(
        {
          kind: "container",
          executable: fakeContainer,
          image: "kota-eval:test",
          kotaBinaryPath: "/opt/kota/bin/kota.mjs",
        },
        {
          PATH: process.env.PATH,
          KOTA_FAKE_CONTAINER_USE_HOST_PATH: "1",
        },
      ),
    };
    try {
      for (const fixture of fixtures) {
        const workDir = join(scratch, fixture.spec.id);
        copyFixtureInitialState(fixture.initialStateDir, workDir);
        const expectationSets = isSingleWorkflowFixtureSpec(fixture.spec)
          ? [fixture.spec.preRunExpectations]
            : [fixture.spec.rounds[0].preRunExpectations];
        for (const expectations of expectationSets) {
          const result = await evaluatePredicateExpectations(
            workDir,
            expectations,
            fixtureScoringContext({
              capabilities,
              fixture,
              executionProfile: TEST_EXECUTION_PROFILE,
            }),
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
  }, 120_000);
});
