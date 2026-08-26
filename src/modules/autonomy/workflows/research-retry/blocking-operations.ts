import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  listResearchRetryCandidates,
  type ResearchRetryCandidate,
} from "./candidates.js";
import {
  checkResearchRetryCapability,
  evaluateCandidate,
  type MarkAttemptResult,
  writeMarkerForCandidate,
} from "./precondition.js";
import type {
  CandidateSummary,
  ExaminedCandidate,
  InspectResult,
} from "./shadow-review.js";

function summarizeCandidate(candidate: ResearchRetryCandidate): CandidateSummary {
  return {
    id: candidate.id,
    updatedAt: candidate.updatedAt,
    urls: candidate.urls,
  };
}

export function inspectResearchRetryCandidatesInWorker(input: {
  workspaceRoot: string;
}): InspectResult {
  const worktree = getRepoWorktreeStatus(input.workspaceRoot);
  const dirty = worktree.available && worktree.dirty;
  const capability = checkResearchRetryCapability(input.workspaceRoot);
  const candidates = listResearchRetryCandidates(input.workspaceRoot);

  const examined: ExaminedCandidate[] = [];
  for (const candidate of candidates) {
    const evaluation = evaluateCandidate({
      urls: candidate.urls,
      body: candidate.body,
      capability,
    });
    if (evaluation.skipReason === null) {
      return {
        dirty,
        candidateCount: candidates.length,
        capability,
        candidate: summarizeCandidate(candidate),
        fingerprint: evaluation.fingerprint,
        marker: evaluation.marker,
        examined,
      };
    }
    examined.push({
      id: candidate.id,
      fingerprint: evaluation.fingerprint,
      marker: evaluation.marker,
      skipReason: evaluation.skipReason,
    });
  }

  return {
    dirty,
    candidateCount: candidates.length,
    capability,
    candidate: null,
    fingerprint: null,
    marker: null,
    examined,
  };
}

export function markResearchRetryAttemptInWorker(input: {
  workspaceRoot: string;
  candidateId: string;
}): MarkAttemptResult {
  return writeMarkerForCandidate(input);
}

export const inspectResearchRetryCandidatesOperation =
  defineWorkflowBlockingOperation<{ workspaceRoot: string }, InspectResult>(
    import.meta.url,
    "inspectResearchRetryCandidatesInWorker",
  );

export const markResearchRetryAttemptOperation =
  defineWorkflowBlockingOperation<
    { workspaceRoot: string; candidateId: string },
    MarkAttemptResult
  >(import.meta.url, "markResearchRetryAttemptInWorker");
