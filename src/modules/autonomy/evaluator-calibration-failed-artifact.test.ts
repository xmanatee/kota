import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowTerminalFinalizerInput } from "#core/workflow/types.js";
import {
  aggregateCalibration,
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
  writeFailedCalibrationArtifact,
} from "./evaluator-calibration.js";

const PROMPT_HASH = "promptv0test";
const FAILED_RUN_ID = "2026-04-20T12-00-00-000Z-builder-b";
const trigger = {
  event: "autonomy.queue.available",
  schemaRef: null,
  payload: {},
} as const;

function failedRunInput(
  root: string,
  agentRunDir: string,
): WorkflowTerminalFinalizerInput {
  return {
    projectDir: root,
    workspaceDir: root,
    metadata: {
      id: FAILED_RUN_ID,
      workflow: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      trigger,
      startedAt: "2026-04-20T11:59:00.000Z",
      completedAt: "2026-04-20T12:00:00.000Z",
      status: "failed",
      durationMs: 60_000,
      runDir: join(".kota", "runs", FAILED_RUN_ID),
      steps: [
        {
          id: "prepare-worktree",
          type: "code",
          status: "success",
          startedAt: "2026-04-20T11:59:00.000Z",
          completedAt: "2026-04-20T11:59:01.000Z",
          durationMs: 1_000,
          output: {
            workspaceDir: root,
            runtimeResources: { agentRunDir },
            taskId: "task-runtime-failure",
          },
        },
        {
          id: "build",
          type: "agent",
          status: "failed",
          startedAt: "2026-04-20T11:59:01.000Z",
          completedAt: "2026-04-20T12:00:00.000Z",
          durationMs: 59_000,
          output: {
            repairIterations: [{ failures: [{ id: "critic-review" }] }],
          },
        },
      ],
    },
    trigger,
    emit: () => {},
    log: () => {},
  };
}

describe("writeFailedCalibrationArtifact", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists terminal failure evidence that can contradict an earlier pass", () => {
    const root = mkdtempSync(join(tmpdir(), "cal-failed-"));
    roots.push(root);
    const runsDir = join(root, ".kota", "runs");
    const failedRunDir = join(runsDir, FAILED_RUN_ID);
    const agentRunDir = join(root, ".kota", "builder-evidence", FAILED_RUN_ID);
    mkdirSync(join(root, "src", "core"), { recursive: true });
    mkdirSync(failedRunDir, { recursive: true });
    mkdirSync(agentRunDir, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "test"], { cwd: root });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: root });
    writeFileSync(join(root, "src", "core", "a.ts"), "export const value = 1;\n");
    execFileSync("git", ["add", "src/core/a.ts"], { cwd: root });
    execFileSync("git", ["commit", "--quiet", "-m", "baseline"], { cwd: root });

    const prior: EvaluatorCalibrationArtifact = {
      runId: "2026-04-20T10-00-00-000Z-builder-a",
      workflow: "builder",
      completedAt: "2026-04-20T10:00:00.000Z",
      verdict: "pass",
      warningCount: 0,
      criticalIssueCount: 0,
      repairIterations: 1,
      finalIterationFailures: [],
      criticFailureCount: 0,
      terminalRunStatus: "success",
      taskId: null,
      taskFinalState: null,
      sourceRevision: "1111111111111111111111111111111111111111",
      sourceFilesChanged: ["src/core/a.ts", "src/core/b.ts"],
      criticPromptHash: PROMPT_HASH,
    };
    const priorRunDir = join(runsDir, prior.runId);
    mkdirSync(priorRunDir, { recursive: true });
    writeFileSync(
      join(priorRunDir, EVALUATOR_CALIBRATION_ARTIFACT),
      JSON.stringify(prior),
    );
    writeFileSync(join(root, "src", "core", "a.ts"), "export const value = 2;\n");
    writeFileSync(
      join(agentRunDir, "critic-review.json"),
      JSON.stringify({
        verdict: "fail",
        critical_issues: ["The changed runtime path is incomplete."],
        warnings: [],
        summary: "Builder repair was exhausted.",
      }),
    );

    const artifact = writeFailedCalibrationArtifact(
      failedRunInput(root, agentRunDir),
      { criticPromptHash: PROMPT_HASH },
    );
    expect(artifact).toMatchObject({
      verdict: "fail",
      terminalRunStatus: "failed",
      sourceRevision: expect.stringMatching(/^[0-9a-f]{40}$/),
      sourceFilesChanged: ["src/core/a.ts"],
      finalIterationFailures: ["critic-review"],
    });

    const aggregate = aggregateCalibration(runsDir, {
      criticPromptHash: PROMPT_HASH,
      windowMs: 7 * 24 * 60 * 60 * 1000,
      followUpWindowMs: 3 * 24 * 60 * 60 * 1000,
      nowMs: Date.parse("2026-04-20T12:30:00.000Z"),
    });
    expect(aggregate).toMatchObject({
      totalRuns: 2,
      passContradictionCount: 1,
      passContradictionRate: 1,
    });
  });
});
