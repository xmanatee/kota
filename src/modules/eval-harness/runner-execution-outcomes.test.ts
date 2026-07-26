import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { createFakeExecutableVerifierSandbox } from "./subprocess-executor-test-helpers.js";

const TEST_VERIFIER = createFakeExecutableVerifierSandbox();

afterAll(TEST_VERIFIER.cleanup);

describe("runFixture execution outcomes", () => {
  let fixturesRoot: string;
  let runsRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ fixturesRoot, runsRoot, cleanup } = setupFixtureTree());
  });

  afterEach(() => {
    cleanup();
  });

  it("initializes git for plain fixtures so git-change predicates can score", async () => {
    const fixtureDir = join(fixturesRoot, "git-mini");
    mkdirSync(join(fixtureDir, "initial"), { recursive: true });
    writeFileSync(
      join(fixtureDir, "fixture.json"),
      JSON.stringify({
        id: "git-mini",
        description: "minimal fixture with git change boundary",
        role: "builder",
        workflowName: "noop",
        budgetMs: 60_000,
        predicates: [
          { kind: "file-exists", path: "output.txt" },
          { kind: "git-changes-within", allowedPaths: ["output.txt"] },
        ],
        preRunExpectations: [
          { predicate: { kind: "file-exists", path: "output.txt" }, expected: "fail" },
        ],
        controlDecisions: ["act"],
        provenance: {
          kind: "smoke-fixture",
          justification: "minimal test fixture for runner git predicate plumbing",
        },
      }),
    );
    const fixture = loadFixture(fixturesRoot, "git-mini");
    const executor: WorkflowExecutor = {
      predicateContext: {
        executableVerifierSandbox: TEST_VERIFIER.sandbox,
      },
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async ({ workingDir }) => {
        writeFileSync(join(workingDir, "output.txt"), "done");
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
    expect(report.predicateResults.every((r) => r.passed)).toBe(true);
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("reports fail when the executor completes but predicates miss", async () => {
    const fixture = loadFixture(fixturesRoot, "mini");
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => ({
        kind: "completed",
        durationMs: 5,
        runArtifactPath: null,
      }),
    };
    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });
    expect(report.run.outcome).toBe("fail");
    expect(report.preRunExpectationResults.every((r) => r.passed)).toBe(true);
    expect(report.predicateResults.some((r) => !r.passed)).toBe(true);
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("rejects an already-satisfied outcome predicate before invoking the executor", async () => {
    const fixture = loadFixture(fixturesRoot, "mini");
    writeFileSync(join(fixture.initialStateDir, "output.txt"), "already done");
    let executorCalls = 0;
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => {
        executorCalls++;
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
    expect(executorCalls).toBe(0);
    expect(report.run.outcome).toBe("configuration-error");
    expect(report.executionOutcome.kind).toBe("not-started");
    expect(report.predicateResults).toEqual([]);
    expect(report.preRunExpectationResults.some((r) => !r.passed)).toBe(true);
    const raw = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "fixture-run.json"), "utf-8"),
    );
    expect(raw.execution.reason).toBe("pre-run-sanity-failed");
    expect(raw.preRunExpectationResults.some((r: { passed: boolean }) => !r.passed)).toBe(
      true,
    );
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("reports timeout distinctly from fail when the executor reports timeout", async () => {
    const fixture = loadFixture(fixturesRoot, "mini");
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => ({
        kind: "timeout",
        durationMs: 60_001,
        runArtifactPath: null,
      }),
    };
    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir: runsRoot,
      runIndex: 0,
      repeatCount: 1,
    });
    expect(report.run.outcome).toBe("timeout");
    cleanupFixtureWorkingDir(report.workingDir);
  });

  it("reports error when the executor throws and surfaces the message in the artifact", async () => {
    const fixture = loadFixture(fixturesRoot, "mini");
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async () => {
        throw new Error("boom");
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
    expect(report.run.outcome).toBe("error");
    const raw = JSON.parse(
      readFileSync(join(report.run.runArtifactPath, "fixture-run.json"), "utf-8"),
    );
    expect(raw.execution.message).toContain("boom");
    cleanupFixtureWorkingDir(report.workingDir);
  });
});
