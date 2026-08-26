import {
  createGeneratedWorkQuestionQueue,
  dismissGeneratedWorkQuestion,
  findGeneratedWorkQuestion,
  generatedWorkProvenanceContext,
  generatedWorkQuestionDedupeKey,
  reconcileGeneratedWorkQuestion,
} from "./generated-work-owner-question.js";
import type {
  GeneratedWorkProposal,
  GeneratedWorkProposalAction,
  GeneratedWorkProposalResult,
} from "./generated-work-proposal-types.js";
import {
  dropGeneratedWorkTask,
  findGeneratedWorkTask,
  writeGeneratedWorkTask,
} from "./generated-work-task.js";

export type * from "./generated-work-proposal-types.js";

const PROPOSAL_KEY_RE = /^[a-z0-9][a-z0-9:._/-]*$/;

export function generatedWorkTaskMutationPaths(
  actions: readonly GeneratedWorkProposalAction[],
): string[] {
  const paths = actions.flatMap((action): string[] => {
    if (action.kind === "created-task" || action.kind === "updated-task") {
      return [action.path];
    }
    if (action.kind === "reopened-task") {
      return [
        `data/tasks/${action.fromState}/${action.taskId}.md`,
        action.path,
      ];
    }
    if (action.kind === "dropped-task") {
      return [
        `data/tasks/${action.fromState}/${action.taskId}.md`,
        `data/tasks/dropped/${action.taskId}.md`,
      ];
    }
    return [];
  });
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

export function normalizeGeneratedWorkProposalKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (!PROPOSAL_KEY_RE.test(normalized)) {
    throw new Error("generated-work proposal key must be a stable lowercase token path");
  }
  return normalized;
}

export function materializeGeneratedWorkProposal(args: {
  workspaceRoot: string;
  proposal: GeneratedWorkProposal;
}): GeneratedWorkProposalResult {
  const proposalKey = normalizeGeneratedWorkProposalKey(args.proposal.proposalKey);
  const proposal = { ...args.proposal, proposalKey } as GeneratedWorkProposal;
  const queue = createGeneratedWorkQuestionQueue(args.workspaceRoot);
  const existingTask = findGeneratedWorkTask(args.workspaceRoot, proposalKey);
  const actions: GeneratedWorkProposalAction[] = [];

  if (proposal.kind === "task") {
    actions.push(...dismissGeneratedWorkQuestion(
      queue,
      proposalKey,
      "The generated-work disposition now routes through a task.",
      proposal.provenance.source,
    ));
    actions.push(...writeGeneratedWorkTask({
      workspaceRoot: args.workspaceRoot,
      proposal,
      existing: existingTask,
    }));
  } else if (proposal.kind === "owner-question") {
    actions.push(...dropGeneratedWorkTask(args.workspaceRoot, existingTask));
    const reconciled = reconcileGeneratedWorkQuestion({
      workspaceRoot: args.workspaceRoot,
      queue,
      input: {
        dedupeKey: generatedWorkQuestionDedupeKey(proposalKey),
        context: generatedWorkProvenanceContext(
          proposal.context,
          proposalKey,
          proposal.provenance,
        ),
        question: proposal.question,
        reason: proposal.reason,
        source: proposal.provenance.source,
        answerBehavior: "record-only",
        origin: proposal.origin,
        proposedAnswers: proposal.proposedAnswers,
      },
    });
    actions.push({
      kind: reconciled.created
        ? "created-owner-question"
        : reconciled.reopened
        ? "reopened-owner-question"
        : reconciled.updated
        ? "updated-owner-question"
        : "noop",
      ...(reconciled.created || reconciled.reopened || reconciled.updated
        ? { questionId: reconciled.item.id }
        : { reason: "owner question is current" }),
    } as GeneratedWorkProposalAction);
  } else {
    actions.push(...dropGeneratedWorkTask(args.workspaceRoot, existingTask));
    actions.push(...dismissGeneratedWorkQuestion(
      queue,
      proposalKey,
      proposal.reason,
      proposal.source,
    ));
    if (actions.length === 0) {
      actions.push({ kind: "noop", reason: "proposal has no active work record" });
    }
  }

  const taskAction = actions.find((action) => "taskId" in action);
  const questionAction = actions.find((action) => "questionId" in action);
  return {
    proposalKey,
    taskId: proposal.kind === "task"
      ? taskAction && "taskId" in taskAction
        ? taskAction.taskId
        : existingTask?.task.id ?? null
      : null,
    ownerQuestionId: proposal.kind === "owner-question"
      ? questionAction && "questionId" in questionAction
        ? questionAction.questionId
        : findGeneratedWorkQuestion(queue, proposalKey)?.id ?? null
      : null,
    actions,
    touchedTaskQueue: actions.some((action) =>
      action.kind === "created-task" ||
      action.kind === "updated-task" ||
      action.kind === "reopened-task" ||
      action.kind === "dropped-task"
    ),
  };
}
