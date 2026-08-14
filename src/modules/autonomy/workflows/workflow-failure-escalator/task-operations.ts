import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  applyWorkflowFailureEscalation,
  proposeWorkflowFailureEscalation,
  type WorkflowFailureEscalationApplied,
  type WorkflowFailureEscalationProposal,
  type WorkflowFailurePattern,
} from "#modules/autonomy/workflow-failure-escalation.js";

type WorkflowFailureProposalInput = {
  projectDir: string;
  patterns: WorkflowFailurePattern[];
};

type WorkflowFailureApplyInput = {
  projectDir: string;
  proposals: WorkflowFailureEscalationProposal[];
  nowIso: string;
};

export function proposeWorkflowFailureTasksInWorker(
  input: WorkflowFailureProposalInput,
): { proposals: WorkflowFailureEscalationProposal[] } {
  return {
    proposals: input.patterns.map((pattern) =>
      proposeWorkflowFailureEscalation(input.projectDir, pattern),
    ),
  };
}

export function applyWorkflowFailureTasksInWorker(
  input: WorkflowFailureApplyInput,
): { applied: WorkflowFailureEscalationApplied[] } {
  return {
    applied: input.proposals.map((proposal) =>
      applyWorkflowFailureEscalation(proposal, {
        projectDir: input.projectDir,
        nowIso: input.nowIso,
      }),
    ),
  };
}

export const proposeWorkflowFailureTasksOperation =
  defineWorkflowBlockingOperation<
    WorkflowFailureProposalInput,
    { proposals: WorkflowFailureEscalationProposal[] }
  >(import.meta.url, "proposeWorkflowFailureTasksInWorker");

export const applyWorkflowFailureTasksOperation =
  defineWorkflowBlockingOperation<
    WorkflowFailureApplyInput,
    { applied: WorkflowFailureEscalationApplied[] }
  >(import.meta.url, "applyWorkflowFailureTasksInWorker");
