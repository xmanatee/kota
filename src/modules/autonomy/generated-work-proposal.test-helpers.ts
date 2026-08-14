import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  GeneratedWorkQuestionProposal,
  GeneratedWorkTaskProposal,
} from "./generated-work-proposal.js";

export const GENERATED_WORK_TASK_STATES = [
  "backlog",
  "ready",
  "doing",
  "blocked",
  "done",
  "dropped",
] as const satisfies readonly RepoTaskState[];

const projectDirs: string[] = [];

export function makeGeneratedWorkProjectDir(label: string): string {
  const projectDir = mkdtempSync(join(tmpdir(), `kota-generated-work-${label}-`));
  projectDirs.push(projectDir);
  for (const state of GENERATED_WORK_TASK_STATES) {
    mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
  }
  execFileSync("git", ["init", "--quiet"], { cwd: projectDir });
  return projectDir;
}

export function cleanupGeneratedWorkProjectDirs(): void {
  for (const projectDir of projectDirs.splice(0)) {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

export function taskProposal(
  overrides: Partial<GeneratedWorkTaskProposal> = {},
): GeneratedWorkTaskProposal {
  return {
    kind: "task",
    proposalKey: "autonomy-issue:stable-fixture",
    title: "Repair stable autonomy issue",
    summary: "Repair the stable autonomy issue through the normal builder path.",
    priority: "p1",
    area: "autonomy",
    taskClass: "Meta",
    body: [
      "## Problem",
      "",
      "A durable autonomy issue needs implementation work.",
      "",
      "## Desired Outcome",
      "",
      "The issue is fixed through builder.",
      "",
      "## Constraints",
      "",
      "- Preserve provenance.",
      "",
      "## Done When",
      "",
      "- The issue is resolved.",
      "",
      "## Source / Intent",
      "",
      "Issue-driven review fixture.",
      "",
      "## Product / Safety Link",
      "",
      "This repair protects Product and Safety execution.",
      "",
      "## Initiative",
      "",
      "One issue, one decision, one implementation path.",
      "",
      "## Acceptance Evidence",
      "",
      "- Focused lifecycle test output.",
    ].join("\n"),
    provenance: {
      source: "improver",
      runId: "review-run-1",
      issueKey: "autonomy-issue-fixture",
      semanticRevision: 1,
      evidenceRefs: [".kota/runs/failure-1/metadata.json"],
    },
    ...overrides,
  };
}

export function questionProposal(
  overrides: Partial<GeneratedWorkQuestionProposal> = {},
): GeneratedWorkQuestionProposal {
  return {
    kind: "owner-question",
    proposalKey: "autonomy-issue:stable-fixture",
    question: "Which repair direction should builder take?",
    reason: "The evidence supports two materially different repairs.",
    context: "Review the durable issue evidence.",
    proposedAnswers: ["Repair the protocol", "Dismiss as external"],
    provenance: {
      source: "improver",
      runId: "review-run-1",
      issueKey: "autonomy-issue-fixture",
      semanticRevision: 1,
      evidenceRefs: [".kota/runs/failure-1/metadata.json"],
    },
    origin: {
      kind: "workflow",
      workflowName: "improver",
      runId: "review-run-1",
      stepId: "apply-disposition",
      taskId: null,
    },
    ...overrides,
  };
}

export function placeTaskInState(
  projectDir: string,
  taskId: string,
  state: RepoTaskState,
): void {
  if (state === "ready") return;
  const readyPath = join(
    projectDir,
    "data",
    "tasks",
    "ready",
    `${taskId}.md`,
  );
  const targetPath = join(
    projectDir,
    "data",
    "tasks",
    state,
    `${taskId}.md`,
  );
  const content = readFileSync(readyPath, "utf-8").replace(
    "status: ready",
    `status: ${state}`,
  );
  renameSync(readyPath, targetPath);
  writeFileSync(targetPath, content, "utf-8");
}
