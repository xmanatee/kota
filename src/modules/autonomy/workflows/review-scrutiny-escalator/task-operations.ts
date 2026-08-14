import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  applyReviewScrutinyEscalation,
  proposeReviewScrutinyEscalation,
  type ReviewScrutinyEscalationApplied,
  type ReviewScrutinyEscalationDetection,
  type ReviewScrutinyEscalationProposal,
} from "#modules/autonomy/review-scrutiny-escalation.js";

type ReviewScrutinyProposalInput = {
  projectDir: string;
  patterns: ReviewScrutinyEscalationDetection["patterns"];
  config: Parameters<typeof proposeReviewScrutinyEscalation>[2];
};

type ReviewScrutinyApplyInput = {
  projectDir: string;
  proposals: ReviewScrutinyEscalationProposal[];
  nowIso: string;
};

export function proposeReviewScrutinyTasksInWorker(
  input: ReviewScrutinyProposalInput,
): { proposals: ReviewScrutinyEscalationProposal[] } {
  return {
    proposals: input.patterns.map((pattern) =>
      proposeReviewScrutinyEscalation(input.projectDir, pattern, input.config),
    ),
  };
}

export function applyReviewScrutinyTasksInWorker(
  input: ReviewScrutinyApplyInput,
): { applied: ReviewScrutinyEscalationApplied[] } {
  return {
    applied: input.proposals.map((proposal) =>
      applyReviewScrutinyEscalation(proposal, {
        projectDir: input.projectDir,
        nowIso: input.nowIso,
      }),
    ),
  };
}

export const proposeReviewScrutinyTasksOperation =
  defineWorkflowBlockingOperation<
    ReviewScrutinyProposalInput,
    { proposals: ReviewScrutinyEscalationProposal[] }
  >(import.meta.url, "proposeReviewScrutinyTasksInWorker");

export const applyReviewScrutinyTasksOperation =
  defineWorkflowBlockingOperation<
    ReviewScrutinyApplyInput,
    { applied: ReviewScrutinyEscalationApplied[] }
  >(import.meta.url, "applyReviewScrutinyTasksInWorker");
