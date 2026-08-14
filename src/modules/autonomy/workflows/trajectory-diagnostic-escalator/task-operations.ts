import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  applyTrajectoryDiagnosticEscalation,
  proposeTrajectoryDiagnosticEscalation,
  type TrajectoryDiagnosticEscalationApplied,
  type TrajectoryDiagnosticEscalationProposal,
  type TrajectoryDiagnosticPattern,
} from "#modules/autonomy/trajectory-diagnostic-escalation.js";

type TrajectoryDiagnosticProposalInput = {
  projectDir: string;
  patterns: TrajectoryDiagnosticPattern[];
};

type TrajectoryDiagnosticApplyInput = {
  projectDir: string;
  proposals: TrajectoryDiagnosticEscalationProposal[];
  nowIso: string;
};

export function proposeTrajectoryDiagnosticTasksInWorker(
  input: TrajectoryDiagnosticProposalInput,
): { proposals: TrajectoryDiagnosticEscalationProposal[] } {
  return {
    proposals: input.patterns.map((pattern) =>
      proposeTrajectoryDiagnosticEscalation(input.projectDir, pattern),
    ),
  };
}

export function applyTrajectoryDiagnosticTasksInWorker(
  input: TrajectoryDiagnosticApplyInput,
): { applied: TrajectoryDiagnosticEscalationApplied[] } {
  return {
    applied: input.proposals.map((proposal) =>
      applyTrajectoryDiagnosticEscalation(proposal, {
        projectDir: input.projectDir,
        nowIso: input.nowIso,
      }),
    ),
  };
}

export const proposeTrajectoryDiagnosticTasksOperation =
  defineWorkflowBlockingOperation<
    TrajectoryDiagnosticProposalInput,
    { proposals: TrajectoryDiagnosticEscalationProposal[] }
  >(import.meta.url, "proposeTrajectoryDiagnosticTasksInWorker");

export const applyTrajectoryDiagnosticTasksOperation =
  defineWorkflowBlockingOperation<
    TrajectoryDiagnosticApplyInput,
    { applied: TrajectoryDiagnosticEscalationApplied[] }
  >(import.meta.url, "applyTrajectoryDiagnosticTasksInWorker");
