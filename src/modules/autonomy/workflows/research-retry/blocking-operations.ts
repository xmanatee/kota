import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  listResearchRetryCandidates,
} from "./candidates.js";
import {
  checkResearchRetryCapability,
  evaluateCandidate,
  type MarkAttemptResult,
  type ResearchSourceTool,
  writeMarkerForCandidate,
} from "./precondition.js";
import type {
  ExaminedCandidate,
  InspectResult,
} from "./shadow-review.js";

export function inspectResearchRetryCandidatesInWorker(input: {
  workspaceRoot: string;
  scopeRoot?: string;
  availableTools: readonly ResearchSourceTool[];
}): InspectResult {
  const worktree = getRepoWorktreeStatus(input.workspaceRoot);
  const dirty = worktree.available && worktree.dirty;
  const capability = checkResearchRetryCapability(input.scopeRoot ?? input.workspaceRoot, input.availableTools);
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
        candidate: { id: candidate.id, digest: candidate.digest, urls: candidate.urls, attemptableUrls: evaluation.attemptableUrls },
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

export function markResearchRetryAttemptInWorker(input: Parameters<typeof writeMarkerForCandidate>[0]): MarkAttemptResult {
  return writeMarkerForCandidate(input);
}

export const inspectResearchRetryCandidatesOperation =
  defineWorkflowBlockingOperation<{ workspaceRoot: string; scopeRoot: string; availableTools: readonly ResearchSourceTool[] }, InspectResult>(
    import.meta.url,
    "inspectResearchRetryCandidatesInWorker",
  );

export const markResearchRetryAttemptOperation =
  defineWorkflowBlockingOperation<
    Parameters<typeof writeMarkerForCandidate>[0],
    MarkAttemptResult
  >(import.meta.url, "markResearchRetryAttemptInWorker");
