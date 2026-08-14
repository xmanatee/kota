import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { checkDocBloat } from "#modules/autonomy/doc-bloat-check.js";
import {
  type AutonomyHealthIssueEvidence,
  collectCurrentAutonomyHealthIssueCards,
} from "#modules/autonomy/health-issue-cards.js";
import { checkRepoHygiene } from "#modules/autonomy/hygiene-check.js";
import {
  aggregateRunOutcomes,
  type RunOutcomeAggregation,
} from "#modules/autonomy/run-outcome-aggregation.js";
import {
  collectImproverTaskGovernance,
  type ImproverTaskGovernanceEvidence,
} from "./task-governance.js";

export type ImproverWorktreeInspection = {
  dirty: boolean;
  summary: string;
};

export type ImproverRepairCheckOperationInput = {
  kind: "doc-bloat" | "repo-hygiene";
  projectDir: string;
};

export function runImproverRepairCheckInWorker(
  input: ImproverRepairCheckOperationInput,
): string {
  return input.kind === "doc-bloat"
    ? checkDocBloat(input.projectDir)
    : checkRepoHygiene(input.projectDir);
}

export const improverRepairCheckOperation =
  defineWorkflowBlockingOperation<
    ImproverRepairCheckOperationInput,
    string
  >(import.meta.url, "runImproverRepairCheckInWorker");

export function gatherImproverRunDataInWorker(input: {
  projectDir: string;
}): RunOutcomeAggregation {
  const store = new WorkflowRunStore(input.projectDir);
  return aggregateRunOutcomes(store.runsDir);
}

export const gatherImproverRunDataOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    RunOutcomeAggregation
  >(import.meta.url, "gatherImproverRunDataInWorker");

export function gatherImproverHealthIssueCardsInWorker(input: {
  projectDir: string;
}): AutonomyHealthIssueEvidence {
  return collectCurrentAutonomyHealthIssueCards(input.projectDir);
}

export const gatherImproverHealthIssueCardsOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    AutonomyHealthIssueEvidence
  >(import.meta.url, "gatherImproverHealthIssueCardsInWorker");

export function gatherImproverTaskGovernanceInWorker(input: {
  projectDir: string;
}): ImproverTaskGovernanceEvidence {
  return collectImproverTaskGovernance(input.projectDir);
}

export const gatherImproverTaskGovernanceOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    ImproverTaskGovernanceEvidence
  >(import.meta.url, "gatherImproverTaskGovernanceInWorker");

export function inspectImproverWorktreeInWorker(input: {
  projectDir: string;
}): ImproverWorktreeInspection {
  const worktree = getRepoWorktreeStatus(input.projectDir);
  return {
    dirty: worktree.available && worktree.dirty,
    summary: worktree.summary,
  };
}

export const inspectImproverWorktreeOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    ImproverWorktreeInspection
  >(import.meta.url, "inspectImproverWorktreeInWorker");
