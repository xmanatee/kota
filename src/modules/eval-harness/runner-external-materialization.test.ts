import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFixture } from "./fixture.js";
import {
  cleanupFixtureWorkingDir,
  runFixture,
  type WorkflowExecutor,
} from "./runner.js";
import {
  setupFixtureTree,
  TEST_EXECUTION_PROFILE,
} from "./runner-test-profiles.js";

describe("runFixture external shims and materialization", () => {
  let fixturesRoot: string;
  let runsRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ fixturesRoot, runsRoot, cleanup } = setupFixtureTree());
  });

  afterEach(() => {
    cleanup();
  });

  it("installs declared external-call shims and forwards the shim dir to the executor", async () => {
    const shimFixturesRoot = mkdtempSync(
      join(tmpdir(), "kota-eval-harness-shims-"),
    );
    const shimRunsRoot = mkdtempSync(
      join(tmpdir(), "kota-eval-harness-shim-runs-"),
    );
    try {
      const fixtureDir = join(shimFixturesRoot, "shim-mini");
      mkdirSync(join(fixtureDir, "initial"), { recursive: true });
      writeFileSync(
        join(fixtureDir, "fixture.json"),
        JSON.stringify({
          id: "shim-mini",
          description: "minimal fixture exercising shim install",
          role: "pr-reviewer",
          workflowName: "noop",
          budgetMs: 60_000,
          predicates: [{ kind: "file-exists", path: "output.txt" }],
          preRunExpectations: [
            {
              predicate: { kind: "file-exists", path: "output.txt" },
              expected: "fail",
            },
          ],
          controlDecisions: ["act"],
          externalCallShims: ["gh"],
          provenance: {
            kind: "smoke-fixture",
            justification: "tests shim install wiring",
          },
        }),
      );
      const fixture = loadFixture(shimFixturesRoot, "shim-mini");
      let observedShimDir: string | undefined;
      const executor: WorkflowExecutor = {
        preflight: () => TEST_EXECUTION_PROFILE,
        execute: async ({ workingDir, externalCallShimDir }) => {
          observedShimDir = externalCallShimDir;
          writeFileSync(join(workingDir, "output.txt"), "done");
          return { kind: "completed", durationMs: 5, runArtifactPath: null };
        },
      };
      const report = await runFixture({
        fixture,
        executor,
        executionProfile: TEST_EXECUTION_PROFILE,
        runArtifactBaseDir: shimRunsRoot,
        runIndex: 0,
        repeatCount: 1,
      });
      expect(report.run.outcome).toBe("pass");
      expect(observedShimDir).toBeDefined();
      expect(observedShimDir!).toBe(join(report.workingDir, ".kota", "shims"));
      const ghShimPath = join(observedShimDir!, "gh");
      expect(readFileSync(ghShimPath, "utf-8").length).toBeGreaterThan(0);
      cleanupFixtureWorkingDir(report.workingDir);
    } finally {
      rmSync(shimFixturesRoot, { recursive: true, force: true });
      rmSync(shimRunsRoot, { recursive: true, force: true });
    }
  });

  it("copies initial state into the isolated working directory without mutating the fixture", async () => {
    writeFileSync(
      join(fixturesRoot, "mini", "initial", "fixture.gitignore"),
      ".kota/\n",
    );
    const fixture = loadFixture(fixturesRoot, "mini");
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async ({ workingDir }) => {
        writeFileSync(join(workingDir, "output.txt"), "done");
        writeFileSync(join(workingDir, "seed.txt"), "tampered");
        return { kind: "completed", durationMs: 5, runArtifactPath: null };
      },
    };
    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });
    expect(report.run.outcome).toBe("pass");
    const originalSeed = readFileSync(
      join(fixture.initialStateDir, "seed.txt"),
      "utf-8",
    );
    expect(originalSeed).toBe("seed");
    expect(readFileSync(join(report.workingDir, ".gitignore"), "utf-8"))
      .toBe(".kota/\n");
    expect(existsSync(join(report.workingDir, "fixture.gitignore"))).toBe(false);
    expect(existsSync(join(fixture.initialStateDir, "fixture.gitignore"))).toBe(true);
    cleanupFixtureWorkingDir(report.workingDir);
  });
});
