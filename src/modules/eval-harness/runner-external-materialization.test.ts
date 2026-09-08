import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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

describe("runFixture materialization", () => {
  let fixturesRoot: string;
  let runsRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ fixturesRoot, runsRoot, cleanup } = setupFixtureTree());
  });

  afterEach(() => {
    cleanup();
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
