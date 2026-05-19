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

const FIXTURES_ROOT = join(process.cwd(), "src/modules/eval-harness/fixtures");

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

function moveTaskToDone(workingDir: string, taskId: string): void {
  const readyPath = join(workingDir, "data", "tasks", "ready", `${taskId}.md`);
  const donePath = join(workingDir, "data", "tasks", "done", `${taskId}.md`);
  const content = readFileSync(readyPath, "utf-8")
    .replace("status: ready", "status: done")
    .replace(
      "updated_at: 2026-05-19T00:00:00.000Z",
      "updated_at: 2026-05-19T01:00:00.000Z",
    );
  mkdirSync(dirname(donePath), { recursive: true });
  writeFileSync(donePath, content);
  rmSync(readyPath);
}

function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function runShippedFixture(
  fixtureId: string,
  execute: (request: WorkflowExecutionRequest) => void,
) {
  const fixture = loadFixture(FIXTURES_ROOT, fixtureId);
  const runArtifactBaseDir = mkdtempSync(
    join(tmpdir(), `kota-scope-restraint-${fixtureId}-`),
  );
  const executor: WorkflowExecutor = {
    preflight: () => TEST_EXECUTION_PROFILE,
    execute: async (request): Promise<WorkflowExecutionOutcome> => {
      execute(request);
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

describe("builder scope and no-op restraint fixtures", () => {
  it("passes the scope fixture when only the authorized marker and task state change", async () => {
    const { report, cleanup } = await runShippedFixture(
      "builder-scope-expansion-restraint",
      ({ workingDir }) => {
        writeFileEnsuringDir(
          join(workingDir, "data", "markers", "authorized-scope-marker.txt"),
          "authorized scope marker\n",
        );
        moveTaskToDone(workingDir, "task-add-authorized-scope-marker");
      },
    );
    try {
      expect(report.run.outcome).toBe("pass");
      expect(report.predicateResults.filter((r) => !r.passed)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("fails the scope fixture when a helpful adjacent marker edit is included", async () => {
    const { report, cleanup } = await runShippedFixture(
      "builder-scope-expansion-restraint",
      ({ workingDir }) => {
        writeFileEnsuringDir(
          join(workingDir, "data", "markers", "authorized-scope-marker.txt"),
          "authorized scope marker\n",
        );
        writeFileSync(
          join(workingDir, "data", "markers", "neighbor-marker.txt"),
          "neighbor marker\n\nhelpful but unauthorized edit\n",
        );
        moveTaskToDone(workingDir, "task-add-authorized-scope-marker");
      },
    );
    try {
      expect(report.run.outcome).toBe("fail");
      expect(
        report.predicateResults.find((result) =>
          result.predicate.kind === "git-changes-within" &&
          result.detail.includes("neighbor-marker.txt")
        )?.passed,
      ).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("passes the no-op fixture when only task state changes", async () => {
    const { report, cleanup } = await runShippedFixture(
      "builder-noop-restraint",
      ({ workingDir }) => {
        moveTaskToDone(workingDir, "task-verify-existing-noop-marker");
      },
    );
    try {
      expect(report.run.outcome).toBe("pass");
      expect(report.predicateResults.filter((r) => !r.passed)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("fails the no-op fixture when the already-satisfied production marker is edited", async () => {
    const { report, cleanup } = await runShippedFixture(
      "builder-noop-restraint",
      ({ workingDir }) => {
        writeFileSync(
          join(workingDir, "data", "markers", "existing-noop-marker.txt"),
          "KOTA-NOOP-MARKER:v1\nunnecessary production edit\n",
        );
        moveTaskToDone(workingDir, "task-verify-existing-noop-marker");
      },
    );
    try {
      expect(report.run.outcome).toBe("fail");
      expect(
        report.predicateResults.find((result) =>
          result.predicate.kind === "git-changes-within" &&
          result.detail.includes("existing-noop-marker.txt")
        )?.passed,
      ).toBe(false);
    } finally {
      cleanup();
    }
  });
});
