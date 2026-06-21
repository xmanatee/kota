import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  SOURCE_FILE_SIZE_WARNING_TYPE,
  type SourceFileSizeWarning,
} from "#modules/autonomy/source-size-check.js";
import type { SourceFileSizeReview } from "#modules/autonomy/source-size-escalation.js";
import { writeSourceFileSizeReviewArtifact } from "#modules/autonomy/source-size-review-artifact.js";
import { writeBuilderRunSummary } from "./run-summary.js";

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
}

function makeContext(
  projectDir: string,
  runDirPath: string,
  buildOutput: Record<string, unknown>,
): WorkflowStepContext {
  return {
    stepResults: {},
    stepOutputs: { build: buildOutput },
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
    trigger: { event: "workflow.completed", payload: {} },
    runTool: async () => ({ content: [] }),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
  } as unknown as WorkflowStepContext;
}

describe("writeBuilderRunSummary source-size evidence", () => {
  let tmpBase: string;
  let projectDir: string;
  let runDirPath: string;

  beforeEach(() => {
    tmpBase = join(tmpdir(), `kota-run-summary-source-size-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    projectDir = join(tmpBase, "project");
    runDirPath = join(tmpBase, "run");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(runDirPath, { recursive: true });
    initGitRepo(projectDir);
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("includes typed exception details from the repair-check artifact", () => {
    writeFileSync(join(projectDir, "change.txt"), "hello\n");
    execSync("git add -A && git commit -m 'test change'", { cwd: projectDir, shell: "/bin/sh" });

    const warning: SourceFileSizeWarning = {
      type: SOURCE_FILE_SIZE_WARNING_TYPE,
      file: "src/cleanup-target.ts",
      lines: 330,
      threshold: 300,
      changedLines: -30,
      message:
        "Changed source file src/cleanup-target.ts is 330 line(s), above the 300-line source-size guideline.",
    };
    const sourceFileSize: SourceFileSizeReview = {
      outcome: "exception",
      warnings: [warning],
      reasons: [
        {
          kind: "open-cleanup-overlap",
          files: ["src/cleanup-target.ts"],
          taskIds: ["task-source-size-cleanup"],
          message:
            "Source-size warnings overlap existing cleanup task(s): task-source-size-cleanup for src/cleanup-target.ts.",
        },
      ],
      exception: {
        kind: "source-size-cleanup",
        taskPath: "data/tasks/doing/task-source-size-cleanup.md",
        files: ["src/cleanup-target.ts"],
        reducingFiles: ["src/cleanup-target.ts"],
      },
      message:
        "Typed source-size cleanup exception from data/tasks/doing/task-source-size-cleanup.md; reducing src/cleanup-target.ts.",
    };
    writeSourceFileSizeReviewArtifact(runDirPath, sourceFileSize);

    const summary = writeBuilderRunSummary(
      makeContext(projectDir, runDirPath, {
        repairWarnings: [
          {
            id: SOURCE_FILE_SIZE_WARNING_TYPE,
            output: JSON.stringify([warning]),
          },
        ],
      }),
    );
    const written = JSON.parse(readFileSync(join(runDirPath, "run-summary.json"), "utf-8"));

    expect(summary.sourceFileSize).toEqual(sourceFileSize);
    expect(written.sourceFileSize).toEqual(sourceFileSize);
    expect(written.warnings).toEqual([warning]);
  });
});
