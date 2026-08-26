import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  type AskOutcomeApplication,
  applyAskOutcome,
  applyOperatorCaptureInstruction,
  type BlockerAction,
  classifyBlockedActions,
  type DeterministicPromotionResult,
  listBlockedTasksWithPreconditions,
  listOperatorCaptureInstructCandidates,
  type OperatorCaptureInstruction,
  type OwnerAskCandidate,
  pickOwnerAskCandidate,
  promoteSatisfiedBlockedTasks,
} from "./promotion.js";

export type InspectBlockedResult = {
  dirty: boolean;
  blockedCount: number;
  ownerAsk: OwnerAskCandidate | null;
  actions: BlockerAction[];
};

export function inspectBlockedInWorker(input: {
  workspaceRoot: string;
  scopeRoot: string;
  nowMs: number;
}): InspectBlockedResult {
  const worktree = getRepoWorktreeStatus(input.workspaceRoot);
  const records = listBlockedTasksWithPreconditions(input.workspaceRoot);
  return {
    dirty: worktree.available && worktree.dirty,
    blockedCount: records.length,
    ownerAsk: pickOwnerAskCandidate(records, input.nowMs),
    actions: classifyBlockedActions(
      records,
      input.workspaceRoot,
      input.nowMs,
      input.scopeRoot,
    ),
  };
}

export function promoteSatisfiedBlockedTasksInWorker(input: {
  workspaceRoot: string;
  scopeRoot: string;
}): DeterministicPromotionResult {
  return promoteSatisfiedBlockedTasks(input.workspaceRoot, input.scopeRoot);
}

export function applyAskOutcomeInWorker(input: {
  workspaceRoot: string;
  candidate: OwnerAskCandidate;
  approved: boolean;
  nowIso: string;
}): AskOutcomeApplication[] {
  return applyAskOutcome({
    workspaceRoot: input.workspaceRoot,
    candidate: input.candidate,
    approved: input.approved,
    now: new Date(input.nowIso),
  });
}

export function instructOperatorCaptureInWorker(input: {
  workspaceRoot: string;
  scopeRoot: string;
  nowMs: number;
}): { instructions: OperatorCaptureInstruction[] } {
  const candidates = listOperatorCaptureInstructCandidates(
    listBlockedTasksWithPreconditions(input.workspaceRoot),
    input.workspaceRoot,
    input.nowMs,
    input.scopeRoot,
  );
  const now = new Date(input.nowMs);
  return {
    instructions: candidates.map((candidate) =>
      applyOperatorCaptureInstruction({
        workspaceRoot: input.workspaceRoot,
        candidate,
        now,
      }),
    ),
  };
}

export const inspectBlockedOperation = defineWorkflowBlockingOperation<
  { workspaceRoot: string; scopeRoot: string; nowMs: number },
  InspectBlockedResult
>(import.meta.url, "inspectBlockedInWorker");

export const promoteSatisfiedBlockedTasksOperation = defineWorkflowBlockingOperation<
  { workspaceRoot: string; scopeRoot: string },
  DeterministicPromotionResult
>(import.meta.url, "promoteSatisfiedBlockedTasksInWorker");

export const applyAskOutcomeOperation = defineWorkflowBlockingOperation<
  {
    workspaceRoot: string;
    candidate: OwnerAskCandidate;
    approved: boolean;
    nowIso: string;
  },
  AskOutcomeApplication[]
>(import.meta.url, "applyAskOutcomeInWorker");

export const instructOperatorCaptureOperation = defineWorkflowBlockingOperation<
  { workspaceRoot: string; scopeRoot: string; nowMs: number },
  { instructions: OperatorCaptureInstruction[] }
>(import.meta.url, "instructOperatorCaptureInWorker");
