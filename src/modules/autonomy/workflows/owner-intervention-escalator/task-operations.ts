import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  applyOwnerInterventionEscalation,
  type OwnerInterventionEscalationApplied,
  type OwnerInterventionEscalationProposal,
  type OwnerInterventionPattern,
  proposeOwnerInterventionEscalation,
} from "#modules/autonomy/owner-intervention-escalation.js";

type OwnerInterventionProposalInput = {
  projectDir: string;
  patterns: OwnerInterventionPattern[];
};

type OwnerInterventionApplyInput = {
  projectDir: string;
  proposals: OwnerInterventionEscalationProposal[];
  nowIso: string;
};

export function proposeOwnerInterventionTasksInWorker(
  input: OwnerInterventionProposalInput,
): { proposals: OwnerInterventionEscalationProposal[] } {
  return {
    proposals: input.patterns.map((pattern) =>
      proposeOwnerInterventionEscalation(input.projectDir, pattern),
    ),
  };
}

export function applyOwnerInterventionTasksInWorker(
  input: OwnerInterventionApplyInput,
): { applied: OwnerInterventionEscalationApplied[] } {
  return {
    applied: input.proposals.map((proposal) =>
      applyOwnerInterventionEscalation(proposal, {
        projectDir: input.projectDir,
        nowIso: input.nowIso,
      }),
    ),
  };
}

export const proposeOwnerInterventionTasksOperation =
  defineWorkflowBlockingOperation<
    OwnerInterventionProposalInput,
    { proposals: OwnerInterventionEscalationProposal[] }
  >(import.meta.url, "proposeOwnerInterventionTasksInWorker");

export const applyOwnerInterventionTasksOperation =
  defineWorkflowBlockingOperation<
    OwnerInterventionApplyInput,
    { applied: OwnerInterventionEscalationApplied[] }
  >(import.meta.url, "applyOwnerInterventionTasksInWorker");
