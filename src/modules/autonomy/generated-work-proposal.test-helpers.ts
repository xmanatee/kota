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
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  GeneratedWorkQuestionProposal,
  GeneratedWorkTaskProposal,
} from "./generated-work-proposal.js";

export const GENERATED_WORK_TASK_STATES = [
  "open",
  "blocked",
  "done",
  "dropped",
] as const satisfies readonly RepoTaskState[];

const scopeRoots: string[] = [];

export function makeGeneratedWorkScopeRoot(label: string): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `kota-generated-work-${label}-`));
  scopeRoots.push(workspaceRoot);
  mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  return workspaceRoot;
}

export function cleanupGeneratedWorkScopeRoots(): void {
  for (const workspaceRoot of scopeRoots.splice(0)) {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

export function taskProposal(
  overrides: Partial<GeneratedWorkTaskProposal> = {},
): GeneratedWorkTaskProposal {
  return {
    kind: "task",
    proposalKey: "autonomy-issue:stable-fixture",
    title: "Repair stable autonomy issue",
    priority: "p1",
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
  workspaceRoot: string,
  taskId: string,
  state: RepoTaskState,
): void {
  if (state === "open") return;
  const activePath = join(
    workspaceRoot,
    "data",
    "tasks",
    `${taskId}.md`,
  );
  const terminal = state === "done" || state === "dropped";
  const targetPath = join(
    workspaceRoot,
    "data",
    "tasks",
    ...(terminal ? ["archive"] : []),
    `${taskId}.md`,
  );
  const parsed = parseFlatFrontMatter(readFileSync(activePath, "utf-8"));
  const content = serializeFlatFrontMatter(
    terminal ? { status: state } : { status: state, priority: "p1" },
    parsed.body,
  );
  if (activePath !== targetPath) renameSync(activePath, targetPath);
  writeFileSync(targetPath, content, "utf-8");
}
