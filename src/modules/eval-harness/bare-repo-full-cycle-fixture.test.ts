import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixture } from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import {
  cleanupFixtureWorkingDir,
  runFixture,
  type WorkflowExecutionOutcome,
  type WorkflowExecutionRequest,
  type WorkflowExecutor,
} from "./runner.js";

const FIXTURE_ID = "builder-bare-repo-full-cycle";
const FIXTURES_ROOT = join(process.cwd(), "src/modules/eval-harness/fixtures");
const TASK_ID = "task-repair-project-code-full-cycle";

const TEST_PROFILE: ResourceProfile = {
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4000,
  memoryKillThresholdMB: 4000,
  hostClass: "test",
};

const TEST_EXECUTION_PROFILE: ExecutionProfilePreflightResult = {
  status: "verified",
  backendKind: "container",
  requestedProfile: TEST_PROFILE,
  observedOrEnforcedProfile: TEST_PROFILE,
  verification: "enforced",
  gateEligible: true,
  eligibilityReason: "verified-profile",
  diagnostics: [],
};

function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function moveTaskToDone(workingDir: string): void {
  const readyPath = join(workingDir, "data", "tasks", "ready", `${TASK_ID}.md`);
  const donePath = join(workingDir, "data", "tasks", "done", `${TASK_ID}.md`);
  const content = readFileSync(readyPath, "utf8")
    .replace("status: ready", "status: done")
    .replace(
      "updated_at: 2026-05-26T00:00:00.000Z",
      "updated_at: 2026-05-26T01:00:00.000Z",
    );
  writeFileEnsuringDir(donePath, content);
  rmSync(readyPath);
}

function writeCorrectImplementation(workingDir: string): void {
  writeFileEnsuringDir(
    join(workingDir, "src", "project-code.mjs"),
    `export function normalizeProjectCode(input) {
  if (typeof input !== "string") {
    throw new TypeError("project code must be a string");
  }
  const normalized = input
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("-");
  if (normalized.length === 0) {
    throw new TypeError("project code requires letters or digits");
  }
  return normalized;
}
`,
  );
}

function writePackageJson(workingDir: string): void {
  writeFileEnsuringDir(
    join(workingDir, "package.json"),
    `${JSON.stringify(
      {
        name: "kota-bare-repo-full-cycle-fixture",
        version: "0.0.0",
        private: true,
        type: "module",
        scripts: {
          test: "node --test test/project-code.test.mjs",
        },
      },
      null,
      2,
    )}\n`,
  );
}

function writeVerificationTest(workingDir: string): void {
  writeFileEnsuringDir(
    join(workingDir, "test", "project-code.test.mjs"),
    `import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProjectCode } from "../src/project-code.mjs";

// KOTA_FULL_CYCLE_VERIFICATION
test("normalizes punctuation and whitespace into stable project codes", () => {
  assert.equal(normalizeProjectCode("  North_Wind / 42 "), "north-wind-42");
  assert.equal(normalizeProjectCode("Alpha__BETA---99"), "alpha-beta-99");
});

test("rejects labels without letters or digits", () => {
  assert.throws(
    () => normalizeProjectCode("!!!"),
    /project code requires letters or digits/,
  );
});
`,
  );
}

async function runFixtureWithCandidate(
  mutate: (request: WorkflowExecutionRequest) => void,
) {
  const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
  const runArtifactBaseDir = mkdtempSync(
    join(tmpdir(), "kota-bare-repo-full-cycle-"),
  );
  const executor: WorkflowExecutor = {
    preflight: () => TEST_EXECUTION_PROFILE,
    execute: async (request): Promise<WorkflowExecutionOutcome> => {
      mutate(request);
      return { kind: "completed", durationMs: 5, runArtifactPath: null };
    },
  };
  const report = await runFixture({
    fixture,
    executor,
    executionProfile: TEST_EXECUTION_PROFILE,
    runArtifactBaseDir,
    runIndex: 0,
    repeatCount: 1,
  });
  return {
    report,
    cleanup: () => {
      cleanupFixtureWorkingDir(report.workingDir);
      rmSync(runArtifactBaseDir, { recursive: true, force: true });
    },
  };
}

describe("builder bare-repo full-cycle fixture", () => {
  it("passes only when setup, verification tests, behavior, and task state are complete", async () => {
    const { report, cleanup } = await runFixtureWithCandidate(({ workingDir }) => {
      writePackageJson(workingDir);
      writeVerificationTest(workingDir);
      writeCorrectImplementation(workingDir);
      moveTaskToDone(workingDir);
    });
    try {
      expect(report.run.outcome).toBe("pass");
      expect(report.predicateResults.filter((result) => !result.passed)).toEqual([]);
      expect(report.objectiveMetrics[0]?.value).toBe(4);
    } finally {
      cleanup();
    }
  }, 30_000);

  it("rejects a behavior-only shortcut without verification tests", async () => {
    const { report, cleanup } = await runFixtureWithCandidate(({ workingDir }) => {
      writeCorrectImplementation(workingDir);
      moveTaskToDone(workingDir);
    });
    try {
      expect(report.run.outcome).toBe("fail");
      expect(
        report.predicateResults.some(
          (result) =>
            !result.passed &&
            result.predicate.kind === "file-exists" &&
            result.predicate.path === "test/project-code.test.mjs",
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  }, 30_000);

  it("rejects authored tests when the runnable package setup is still broken", async () => {
    const { report, cleanup } = await runFixtureWithCandidate(({ workingDir }) => {
      writeVerificationTest(workingDir);
      writeCorrectImplementation(workingDir);
      moveTaskToDone(workingDir);
    });
    try {
      expect(report.run.outcome).toBe("fail");
      expect(
        report.predicateResults.some(
          (result) =>
            !result.passed &&
            result.predicate.kind === "file-contains" &&
            result.predicate.path === "package.json",
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  }, 30_000);
});
