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
  projectDir: string;
  nowMs: number;
}): InspectBlockedResult {
  const worktree = getRepoWorktreeStatus(input.projectDir);
  const records = listBlockedTasksWithPreconditions(input.projectDir);
  return {
    dirty: worktree.available && worktree.dirty,
    blockedCount: records.length,
    ownerAsk: pickOwnerAskCandidate(records, input.nowMs),
    actions: classifyBlockedActions(records, input.projectDir, input.nowMs),
  };
}

export function promoteSatisfiedBlockedTasksInWorker(input: {
  projectDir: string;
}): DeterministicPromotionResult {
  return promoteSatisfiedBlockedTasks(input.projectDir);
}

export function applyAskOutcomeInWorker(input: {
  projectDir: string;
  candidate: OwnerAskCandidate;
  approved: boolean;
  nowIso: string;
}): AskOutcomeApplication[] {
  return applyAskOutcome({
    projectDir: input.projectDir,
    candidate: input.candidate,
    approved: input.approved,
    now: new Date(input.nowIso),
  });
}

export function instructOperatorCaptureInWorker(input: {
  projectDir: string;
  nowMs: number;
}): { instructions: OperatorCaptureInstruction[] } {
  const candidates = listOperatorCaptureInstructCandidates(
    listBlockedTasksWithPreconditions(input.projectDir),
    input.projectDir,
    input.nowMs,
  );
  const now = new Date(input.nowMs);
  return {
    instructions: candidates.map((candidate) =>
      applyOperatorCaptureInstruction({
        projectDir: input.projectDir,
        candidate,
        now,
      }),
    ),
  };
}

export const inspectBlockedOperation = defineWorkflowBlockingOperation<
  { projectDir: string; nowMs: number },
  InspectBlockedResult
>(import.meta.url, "inspectBlockedInWorker");

export const promoteSatisfiedBlockedTasksOperation = defineWorkflowBlockingOperation<
  { projectDir: string },
  DeterministicPromotionResult
>(import.meta.url, "promoteSatisfiedBlockedTasksInWorker");

export const applyAskOutcomeOperation = defineWorkflowBlockingOperation<
  {
    projectDir: string;
    candidate: OwnerAskCandidate;
    approved: boolean;
    nowIso: string;
  },
  AskOutcomeApplication[]
>(import.meta.url, "applyAskOutcomeInWorker");

export const instructOperatorCaptureOperation = defineWorkflowBlockingOperation<
  { projectDir: string; nowMs: number },
  { instructions: OperatorCaptureInstruction[] }
>(import.meta.url, "instructOperatorCaptureInWorker");
