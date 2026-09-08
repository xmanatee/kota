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
  GeneratedWorkProposal,
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

export function planGeneratedWorkTaskRetirement(
  existing: GeneratedWorkTaskRecord | null,
): Extract<GeneratedWorkProposalAction, { kind: "dropped-task" }> | null {
  if (!existing || existing.task.state === "done" || existing.task.state === "dropped") return null;
  return { kind: "dropped-task", taskId: existing.task.id, fromState: existing.task.state };
}

export function dropGeneratedWorkTask(
  workspaceRoot: string,
  existing: GeneratedWorkTaskRecord | null,
  proposal: Exclude<GeneratedWorkProposal, { kind: "task" }>,
): GeneratedWorkProposalAction[] {
  if (!existing) return [];
  const retirement = planGeneratedWorkTaskRetirement(existing);
  const body = `${existing.task.body.replace(RETIREMENT_RECORD, "").trim()}\n\n${retirementRecord(proposal)}\n`;
  if (!retirement && body.trim() === existing.task.body.trim()) return [];
  if (retirement) moveTaskById(workspaceRoot, retirement.taskId, "dropped");
  const state = existing.task.state === "done" ? "done" : "dropped";
  const path = getRepoTaskPath(workspaceRoot, state, existing.task.id);
  writeRepoTaskFile(workspaceRoot, path,
    serializeFlatFrontMatter({ status: state }, body));
  if (state === "done") {
    return [{ kind: "updated-task", taskId: existing.task.id, path: join("data", "tasks", "archive", `${existing.task.id}.md`) }];
  }
  return [{ kind: "dropped-task", taskId: existing.task.id, fromState: existing.task.state }];
}

const RETIREMENT_RECORD = /^<!-- generated-work retirement: [a-f0-9]{64} -->\s*$/gm;

export function hasGeneratedWorkRetirement(existing: GeneratedWorkTaskRecord): boolean {
  return (existing.task.state === "done" || existing.task.state === "dropped") &&
    existing.task.body.match(RETIREMENT_RECORD) !== null;
}

function retirementRecord(proposal: Exclude<GeneratedWorkProposal, { kind: "task" }>): string {
  const digest = createHash("sha256").update(JSON.stringify(proposal)).digest("hex");
  return `<!-- generated-work retirement: ${digest} -->`;
}

/** The integrated task records which disposition owns its deferred effects. */
export function ownsGeneratedWorkRetirement(
  workspaceRoot: string,
  proposal: Exclude<GeneratedWorkProposal, { kind: "task" }>,
): boolean {
  const existing = findGeneratedWorkTask(workspaceRoot, proposal.proposalKey);
  return existing !== null && hasGeneratedWorkRetirement(existing) &&
    existing.task.body.trim().endsWith(retirementRecord(proposal));
}
