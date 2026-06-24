import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT,
  OBSERVABILITY_OBLIGATION_WARNING_TYPE,
  type ObservabilityObligationReview,
  writeObservabilityObligationReviewArtifact,
} from "#modules/autonomy/observability-obligation.js";
import { writeBuilderRunSummary } from "./run-summary.js";

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
}

function makeContext(projectDir: string, runDirPath: string): WorkflowStepContext {
  return {
    stepResults: {},
    stepOutputs: { build: {} },
    previousOutput: undefined,
    stepOutputList: [],
    projectDir,
    workflow: {
      name: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      runId: "2026-01-01T00-00-00-000Z-builder-test",
      runDir: ".kota/runs/test",
      runDirPath,
    },
		trigger: { event: "workflow.completed", schemaRef: null, payload: {} },
		runTool: async () => ({ content: "" }),
    emit: () => {},
		requestRestart: () => {},
		readPrompt: () => "",
		readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
		reportProgress: () => {},
		triggerWorkflow: async () => ({ runId: "queued-run", status: "queued" }),
	} as WorkflowStepContext;
}

describe("writeBuilderRunSummary observability evidence", () => {
  let tmpBase: string;
  let projectDir: string;
  let runDirPath: string;

  beforeEach(() => {
    tmpBase = join(
      tmpdir(),
      `kota-run-summary-observability-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    projectDir = join(tmpBase, "project");
    runDirPath = join(tmpBase, "run");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(runDirPath, { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("includes the observability obligation artifact in run-summary.json", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    execSync("git add -A && git commit -m 'test change'", {
      cwd: projectDir,
      shell: "/bin/sh",
    });
    const review: ObservabilityObligationReview = {
      type: OBSERVABILITY_OBLIGATION_WARNING_TYPE,
      outcome: "warning",
      candidates: [
        {
          file: "src/core/workflow/retry.ts",
          status: "missing",
          reasons: [
            {
              kind: "retry-recovery",
              message: "changed retry behavior",
            },
          ],
          evidence: [],
          message: "No inspectable observability evidence found.",
        },
      ],
      satisfiedFiles: [],
      missingFiles: ["src/core/workflow/retry.ts"],
      message: "1 observability-sensitive candidate file lacks evidence",
      followUpTask: {
        title: "Add observability evidence for agent-authored runtime changes",
        summary: "Diagnostic found a runtime-sensitive staged change without evidence.",
        candidateFiles: ["src/core/workflow/retry.ts"],
        artifact: OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT,
      },
    };
    writeObservabilityObligationReviewArtifact(runDirPath, review);

    const summary = writeBuilderRunSummary(makeContext(projectDir, runDirPath));
    const written = JSON.parse(readFileSync(join(runDirPath, "run-summary.json"), "utf-8"));

    expect(summary.observabilityObligations).toEqual(review);
    expect(written.observabilityObligations).toEqual(review);
  });
});
