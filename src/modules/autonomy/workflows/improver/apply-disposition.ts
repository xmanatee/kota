import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { AutonomyIssue } from "#modules/autonomy/autonomy-issue-projection.js";
import { autonomyIssueOwnerFingerprint } from "#modules/autonomy/autonomy-issue-reconciliation.js";
import { stageGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import { type DeterministicRecoveryResult, executeDeterministicRecovery } from "./deterministic-recovery.js";
import type { AppliedDisposition } from "./disposition-publication.js";
import type { IssueDisposition } from "./issue-disposition.js";
import { proposalFor } from "./issue-work-proposal.js";

type ApplyDispositionInput = {
  workspaceRoot: string;
  scopeRoot: string;
  disposition: IssueDisposition;
  issue: AutonomyIssue;
  workflowRunId: string;
};

export function applyDispositionInWorker(
  input: ApplyDispositionInput,
): AppliedDisposition {
  const proposal = proposalFor(
    input.issue,
    input.disposition,
    input.workflowRunId,
  );
  let recovery: DeterministicRecoveryResult | null = null;
  if (input.disposition.action === "recover") {
    if (input.disposition.recoveryAction !== "doctor.fix") {
      throw new Error("Recover dispositions require the doctor.fix action");
    }
    recovery = executeDeterministicRecovery({
      scopeRoot: input.scopeRoot,
      issue: input.issue,
      action: input.disposition.recoveryAction,
    });
  }
  const materialized = stageGeneratedWorkProposal({
    workspaceRoot: input.workspaceRoot,
    proposal,
  });
  return {
    issueKey: input.issue.issueKey,
    semanticRevision: input.issue.semanticRevision,
    ownerFingerprint: autonomyIssueOwnerFingerprint(input.issue),
    disposition: input.disposition,
    proposal,
    materialized,
    recovery,
  };
}

export const applyDispositionOperation = defineWorkflowBlockingOperation<
  ApplyDispositionInput,
  AppliedDisposition
>(import.meta.url, "applyDispositionInWorker");

