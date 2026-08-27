import { createHash } from "node:crypto";
import { join } from "node:path";
import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  getRepoTaskPath,
  listFullRepoTasks,
  moveTaskById,
  type RepoTaskFullRecord,
  reopenTaskById,
  writeRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  GeneratedWorkProposalAction,
  GeneratedWorkTaskProposal,
} from "./generated-work-proposal-types.js";

export type GeneratedWorkTaskRecord = { task: RepoTaskFullRecord };

function stableTaskId(proposalKey: string): string {
  const digest = createHash("sha256").update(proposalKey).digest("hex").slice(0, 16);
  return `task-generated-${digest}`;
}

function taskBody(proposal: GeneratedWorkTaskProposal): string {
  return `# ${proposal.title}\n\n${proposal.body.trim()}\n`;
}

export function findGeneratedWorkTask(
  workspaceRoot: string,
  proposalKey: string,
): GeneratedWorkTaskRecord | null {
  const id = stableTaskId(proposalKey);
  const task = listFullRepoTasks(workspaceRoot).find((candidate) => candidate.id === id);
  return task ? { task } : null;
}

export function writeGeneratedWorkTask(args: {
  workspaceRoot: string;
  proposal: GeneratedWorkTaskProposal;
  existing: GeneratedWorkTaskRecord | null;
}): GeneratedWorkProposalAction[] {
  const taskId = stableTaskId(args.proposal.proposalKey);
  const actions: GeneratedWorkProposalAction[] = [];
  if (args.existing?.task.state === "done" || args.existing?.task.state === "dropped") {
    const fromState = args.existing.task.state;
    reopenTaskById(args.workspaceRoot, taskId, args.proposal.priority);
    actions.push({
      kind: "reopened-task",
      taskId,
      path: join("data", "tasks", `${taskId}.md`),
      fromState,
    });
  }

  const content = serializeFlatFrontMatter(
    { status: "open", priority: args.proposal.priority },
    taskBody(args.proposal),
  );
  const current = listFullRepoTasks(args.workspaceRoot).find((task) => task.id === taskId);
  if (current?.state === "blocked") moveTaskById(args.workspaceRoot, taskId, "open");
  if (current?.state === "open" && current.body.trim() === taskBody(args.proposal).trim() && current.priority === args.proposal.priority) {
    return actions.length ? actions : [{ kind: "noop", reason: "task is current" }];
  }
  const path = getRepoTaskPath(args.workspaceRoot, "open", taskId);
  writeRepoTaskFile(args.workspaceRoot, path, content);
  actions.push({
    kind: args.existing ? "updated-task" : "created-task",
    taskId,
    path: join("data", "tasks", `${taskId}.md`),
  });
  return actions;
}

export function dropGeneratedWorkTask(
  workspaceRoot: string,
  existing: GeneratedWorkTaskRecord | null,
): GeneratedWorkProposalAction[] {
  if (!existing || existing.task.state === "done" || existing.task.state === "dropped") return [];
  moveTaskById(workspaceRoot, existing.task.id, "dropped");
  return [{ kind: "dropped-task", taskId: existing.task.id, fromState: existing.task.state }];
}
