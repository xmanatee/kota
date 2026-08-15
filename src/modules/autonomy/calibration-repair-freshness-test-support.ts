import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALIBRATION_REPAIR_TASK_ID } from "./calibration-repair.js";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  EVALUATOR_CALIBRATION_STEP_ID,
  type EvaluatorCalibrationArtifact,
} from "./evaluator-calibration.js";

export function git(projectDir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: projectDir, encoding: "utf8" }).trim();
}

export function commitAll(projectDir: string, message: string): string {
  git(projectDir, ["add", "-A"]);
  git(projectDir, ["commit", "--allow-empty", "-m", message, "--quiet"]);
  return git(projectDir, ["rev-parse", "HEAD"]);
}

export function makeProject(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "cal-freshness-"));
  mkdirSync(join(projectDir, "data", "tasks", "done"), { recursive: true });
  mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
  git(projectDir, ["init", "--quiet"]);
  git(projectDir, ["config", "user.email", "test@example.com"]);
  git(projectDir, ["config", "user.name", "test"]);
  git(projectDir, ["config", "commit.gpgsign", "false"]);
  commitAll(projectDir, "initial");
  return projectDir;
}

export function closeRepairTask(
  projectDir: string,
): { path: string; revision: string } {
  const path = join(
    projectDir,
    "data",
    "tasks",
    "done",
    `${CALIBRATION_REPAIR_TASK_ID}.md`,
  );
  writeFileSync(path, `---\nid: ${CALIBRATION_REPAIR_TASK_ID}\nstatus: done\n---\n`);
  return { path, revision: commitAll(projectDir, "close repair") };
}

export function commitDescendant(projectDir: string): string {
  writeFileSync(join(projectDir, "post-fix.ts"), "export const fixed = true;\n");
  return commitAll(projectDir, "post-fix builder");
}

export type SeedArtifactOptions = {
  metadataId?: string;
  metadataWorkflow?: string;
  metadataStatus?: string;
  artifactRunId?: string;
  artifactWorkflow?: string;
  artifactTerminalStatus?: EvaluatorCalibrationArtifact["terminalRunStatus"];
  stepId?: string;
  stepStatus?: string;
};

export type SeededArtifact = {
  runDir: string;
  artifactPath: string;
  stepPath: string;
  metadataPath: string;
};

function writeJson(path: string, value: object): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function seedArtifact(
  projectDir: string,
  runId: string,
  sourceRevision: string,
  taskId: string | null,
  options: SeedArtifactOptions = {},
): SeededArtifact {
  const runDir = join(projectDir, ".kota", "runs", runId);
  mkdirSync(join(runDir, "steps"), { recursive: true });
  const artifact: EvaluatorCalibrationArtifact = {
    runId: options.artifactRunId ?? runId,
    workflow: options.artifactWorkflow ?? "builder",
    completedAt: "2099-01-01T00:00:00.000Z",
    verdict: "pass",
    warningCount: 0,
    criticalIssueCount: 0,
    repairIterations: 1,
    finalIterationFailures: [],
    criticFailureCount: 0,
    terminalRunStatus: options.artifactTerminalStatus ?? "success",
    sourceRevision,
    taskId,
    taskFinalState: taskId === CALIBRATION_REPAIR_TASK_ID ? "done" : null,
    sourceFilesChanged: ["src/modules/autonomy/calibration-repair.ts"],
    criticPromptHash: "a9c80b96e38f",
  };
  const step = {
    id: options.stepId ?? EVALUATOR_CALIBRATION_STEP_ID,
    type: "code",
    status: options.stepStatus ?? "success",
    startedAt: "2099-01-01T00:00:00.000Z",
    completedAt: "2099-01-01T00:00:01.000Z",
    durationMs: 1_000,
    output: artifact,
  };
  const metadata = {
    id: options.metadataId ?? runId,
    workflow: options.metadataWorkflow ?? "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "autonomy.queue.available", payload: {} },
    startedAt: "2099-01-01T00:00:00.000Z",
    completedAt: "2099-01-01T00:00:02.000Z",
    status: options.metadataStatus ?? "success",
    durationMs: 2_000,
    runDir: join(".kota", "runs", runId),
    steps: [step],
  };
  const artifactPath = join(runDir, EVALUATOR_CALIBRATION_ARTIFACT);
  const stepPath = join(runDir, "steps", `${EVALUATOR_CALIBRATION_STEP_ID}.json`);
  const metadataPath = join(runDir, "metadata.json");
  writeJson(artifactPath, artifact);
  writeJson(stepPath, step);
  writeJson(metadataPath, metadata);
  return { runDir, artifactPath, stepPath, metadataPath };
}
