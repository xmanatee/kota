import type { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  dismissGeneratedWorkQuestion,
  generatedWorkProvenanceContext,
  generatedWorkQuestionDedupeKey,
  reconcileGeneratedWorkQuestion,
} from "./generated-work-owner-question.js";
import {
  generatedWorkTaskMutationPaths,
  normalizeGeneratedWorkProposalKey,
} from "./generated-work-proposal.js";
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

export type StagedGeneratedWorkOwnerEffect =
  | { kind: "owner-question-pending" }
  | { kind: "owner-question-dismissal-pending" };

export type StagedGeneratedWorkProposalResult = Omit<
  GeneratedWorkProposalResult,
  "actions"
> & {
  actions: Array<GeneratedWorkProposalAction | StagedGeneratedWorkOwnerEffect>;
};

export type FinalizedGeneratedWorkOwnerEffects = {
  ownerQuestionId: string | null;
  actions: GeneratedWorkProposalAction[];
};

export function stageGeneratedWorkProposal(args: {
  projectDir: string;
  proposal: GeneratedWorkProposal;
}): StagedGeneratedWorkProposalResult {
  const proposalKey = normalizeGeneratedWorkProposalKey(args.proposal.proposalKey);
  const proposal = { ...args.proposal, proposalKey } as GeneratedWorkProposal;
  const existingTask = findGeneratedWorkTask(args.projectDir, proposalKey);
  const actions: StagedGeneratedWorkProposalResult["actions"] = [];

  if (proposal.kind === "task") {
    actions.push({ kind: "owner-question-dismissal-pending" });
    actions.push(...writeGeneratedWorkTask({
      projectDir: args.projectDir,
      proposal,
      existing: existingTask,
    }));
  } else if (proposal.kind === "owner-question") {
    actions.push(...dropGeneratedWorkTask(args.projectDir, existingTask));
    actions.push({ kind: "owner-question-pending" });
  } else {
    actions.push(...dropGeneratedWorkTask(args.projectDir, existingTask));
    actions.push({ kind: "owner-question-dismissal-pending" });
  }

  const taskAction = actions.find((action) => "taskId" in action);
  const taskId = proposal.kind === "task"
    ? taskAction && "taskId" in taskAction
      ? taskAction.taskId
      : existingTask?.task.id ?? null
    : null;
  return {
    proposalKey,
    taskId,
    ownerQuestionId: null,
    actions,
    touchedTaskQueue: generatedWorkTaskMutationPaths(
      actions.filter(
        (action): action is GeneratedWorkProposalAction =>
          action.kind !== "owner-question-pending" &&
          action.kind !== "owner-question-dismissal-pending",
      ),
    ).length > 0,
  };
}

export function finalizeGeneratedWorkProposal(args: {
  projectDir: string;
  ownerQuestionQueue: OwnerQuestionQueue;
  proposal: GeneratedWorkProposal;
  staged: StagedGeneratedWorkProposalResult;
}): GeneratedWorkProposalResult {
  const proposalKey = normalizeGeneratedWorkProposalKey(args.proposal.proposalKey);
  if (proposalKey !== args.staged.proposalKey) {
    throw new Error("generated-work staged proposal identity changed before publication");
  }
  const repositoryActions = args.staged.actions.filter(
    (action): action is GeneratedWorkProposalAction =>
      action.kind !== "owner-question-pending" &&
      action.kind !== "owner-question-dismissal-pending",
  );
  const ownerEffects = finalizeGeneratedWorkOwnerEffects({
    projectDir: args.projectDir,
    ownerQuestionQueue: args.ownerQuestionQueue,
    proposal: args.proposal,
  });

  return {
    proposalKey,
    taskId: args.staged.taskId,
    ownerQuestionId: ownerEffects.ownerQuestionId,
    actions: [...repositoryActions, ...ownerEffects.actions],
    touchedTaskQueue: args.staged.touchedTaskQueue,
  };
}

export function finalizeGeneratedWorkOwnerEffects(args: {
  projectDir: string;
  ownerQuestionQueue: OwnerQuestionQueue;
  proposal: GeneratedWorkProposal;
}): FinalizedGeneratedWorkOwnerEffects {
  const proposalKey = normalizeGeneratedWorkProposalKey(args.proposal.proposalKey);
  if (args.proposal.kind === "owner-question") {
    const reconciled = reconcileGeneratedWorkQuestion({
      projectDir: args.projectDir,
      queue: args.ownerQuestionQueue,
      input: {
        dedupeKey: generatedWorkQuestionDedupeKey(proposalKey),
        context: generatedWorkProvenanceContext(
          args.proposal.context,
          proposalKey,
          args.proposal.provenance,
        ),
        question: args.proposal.question,
        reason: args.proposal.reason,
        source: args.proposal.provenance.source,
        answerBehavior: "record-only",
        origin: args.proposal.origin,
        proposedAnswers: args.proposal.proposedAnswers,
      },
    });
    return {
      ownerQuestionId: reconciled.item.id,
      actions: [{
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
      } as GeneratedWorkProposalAction],
    };
  }
  const actions = dismissGeneratedWorkQuestion(
    args.ownerQuestionQueue,
    proposalKey,
    args.proposal.kind === "task"
      ? "The generated-work disposition now routes through a task."
      : args.proposal.reason,
    args.proposal.kind === "task"
      ? args.proposal.provenance.source
      : args.proposal.source,
  );
  return {
    ownerQuestionId: null,
    actions,
  };
}
