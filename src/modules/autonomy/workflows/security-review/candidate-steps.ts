import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import { writeSecurityReviewAgentInput } from "./agent-input.js";
import {
  securityReviewCandidateScanOperation,
} from "./blocking-operations.js";
import { collectSecurityReviewGitEvidence } from "./due-check.js";
import { candidateReviewInputArtifact, type ReviewInputReference, readSecurityReviewCandidates, refreshedReviewInputArtifact, retainedReviewInputArtifact, reviewInputReferenceSchema } from "./review-input-artifact.js";
import { decodeSecurityReviewState, evidenceRequestSchema, SECURITY_REVIEW_STATE_KEY, securityReviewPathUnavailable } from "./review-state.js";
import {
  type SecurityReviewCandidate,
  type SecurityReviewCandidatePacket,
  writeSecurityReviewOutcome,
} from "./security-review.js";

type AgentCandidate = Omit<SecurityReviewCandidate, "excerpt">;
type AgentCandidatePacket = Pick<
  SecurityReviewCandidatePacket,
  "artifactPath" | "candidateCount" | "truncated"
> & {
  candidates: AgentCandidate[];
  redacted: boolean;
};

// This ordinary code-step output is replayed by the runtime on retry. Only
// identity is retained; the scan below refreshes content at the execution head.
export const retainReviewInput = typedCodeStep<ReviewInputReference>({
  id: "retain-review-input",
  type: "code",
  validate: (raw) => reviewInputReferenceSchema.parse(raw),
  run: async ({ workspaceRoot, scopeRoot, stateDir, state, runCommand, trigger, workflow }) => {
    const reviewState = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
    const explicit = trigger.payload.evidence === undefined ? null : evidenceRequestSchema.parse(trigger.payload.evidence);
    const git = await collectSecurityReviewGitEvidence({ workspaceRoot, scopeRoot, stateDir, runCommand,
      reviewState, evidencePaths: explicit?.paths, evidenceRequestId: explicit?.id,
    });
    const request = explicit === null
      ? [...reviewState.evidenceRequests].filter(({ request, reviewed }) => request.paths.some((path) => reviewed[path] !== git.contentDigests[path] && !securityReviewPathUnavailable(reviewState, path, git.contentDigests, request.id))).sort((a, b) => Number(b.request.critical) - Number(a.request.critical))[0]?.request ?? null
      : explicit;
    const evidenceRequest = request && !reviewState.reviewedEvidenceIds.includes(request.id) ? request : null;
    if (git.currentHead.kind !== "commit") throw new Error("Security review requires a readable pinned Git head");
    const unreviewedSurfaces = { ...git.previousSurfaces };
    for (const path of evidenceRequest?.paths ?? []) {
      unreviewedSurfaces[path] = [...new Set([...unreviewedSurfaces[path] ?? [], "reported-boundary" as const])];
    }
    return retainedReviewInputArtifact.write(workflow.runDirPath, { evidenceRequest, unreviewedSurfaces });
  },
});

export const refreshReviewInput = typedCodeStep<ReviewInputReference>({
  id: "refresh-review-input",
  type: "code",
  rerunOnRetry: true,
  validate: (raw) => reviewInputReferenceSchema.parse(raw),
  run: async (ctx) => {
    const { workspaceRoot, scopeRoot, stateDir, state, runCommand } = ctx;
    const reviewState = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
    const retained = retainedReviewInputArtifact.read(ctx.workflow.runDirPath, retainReviewInput.outputRequired(ctx));
    const evidenceRequest = retained.evidenceRequest && !reviewState.reviewedEvidenceIds.includes(retained.evidenceRequest.id)
      ? retained.evidenceRequest : null;
    for (const [path, surfaces] of Object.entries(retained.unreviewedSurfaces)) {
      reviewState.unreviewedSurfaces[path] = [...new Set([...reviewState.unreviewedSurfaces[path] ?? [], ...surfaces])];
    }
    const git = await collectSecurityReviewGitEvidence({ workspaceRoot, scopeRoot, stateDir, runCommand,
      reviewState, evidencePaths: evidenceRequest?.paths, evidenceRequestId: evidenceRequest?.id,
    });
    if (git.currentHead.kind !== "commit") throw new Error("Security review requires a readable pinned Git head");
    const evidenceReviewed = Object.fromEntries(Object.entries(
      reviewState.evidenceRequests.find((entry) => entry.request.id === evidenceRequest?.id)?.reviewed ?? {},
    ).filter(([path, digest]) => git.contentDigests[path] === digest));
    const evidencePaths = evidenceRequest?.paths.filter((path) => evidenceReviewed[path] === undefined && !securityReviewPathUnavailable(reviewState, path, git.contentDigests, evidenceRequest?.id ?? null)) ?? [];
    return refreshedReviewInputArtifact.write(ctx.workflow.runDirPath, {
      currentHead: git.currentHead, changedPaths: git.changedPaths,
      contentDigests: git.contentDigests, previousSurfaces: git.previousSurfaces,
      evidenceRequest, evidenceReviewed, evidencePaths,
    });
  },
});

export const scanCandidates = typedCodeStep<ReviewInputReference>({
  id: "scan-candidates",
  type: "code",
  validate: (raw) => reviewInputReferenceSchema.parse(raw),
  run: async (ctx) => {
    const { workspaceRoot, trigger, workflow, runBlocking } = ctx;
    const git = refreshedReviewInputArtifact.read(ctx.workflow.runDirPath, refreshReviewInput.outputRequired(ctx));
    const { evidencePaths } = git;
    const packet = await runBlocking(securityReviewCandidateScanOperation, {
      workspaceRoot,
      paths: [...new Set([...evidencePaths, ...git.changedPaths])],
      evidencePaths,
      previousSurfaces: git.previousSurfaces,
      runDirPath: workflow.runDirPath,
      trigger: { event: trigger.event, payload: trigger.payload },
    });
    if (packet.candidates.some((candidate) => git.contentDigests[candidate.path] === undefined)) throw new Error("Security candidate is outside the pinned Git input");
    return candidateReviewInputArtifact.write(workflow.runDirPath, {
      input: refreshReviewInput.outputRequired(ctx),
      candidates: packet.candidates.map(
        ({ id, surface, path, line, matcher }) => ({
          id,
          surface,
          path,
          line,
          matcher,
        }),
      ),
      candidateCount: packet.candidateCount,
      artifactPath: packet.artifactPath,
      truncated: packet.truncated,
    });
  },
});

export function scannedCandidates(ctx: Pick<WorkflowStepContext, "stepOutputs" | "workflow">) {
  return readSecurityReviewCandidates(ctx.workflow.runDirPath, scanCandidates.outputRequired(ctx), refreshReviewInput.outputRequired(ctx));
}

// Scrubbed summaries are for agent discovery only. Domain consumers reload the
// scan reference and its pinned input, including after persisted finalization.
export const describeCandidates = typedCodeStep<AgentCandidatePacket>({
  id: "describe-candidates", type: "code", exposeOutputToAgent: true,
  rerunOnRetry: true,
  validate: (raw) => expectStructuredOutput<AgentCandidatePacket>(raw, ["candidates", "candidateCount", "artifactPath", "truncated", "redacted"]),
  run: (ctx) => {
    const { candidates, candidateCount, truncated } = scannedCandidates(ctx);
    const exported = writeSecurityReviewAgentInput(ctx, "security-review-candidates.json", {
      source: scanCandidates.outputRequired(ctx), candidates, candidateCount, truncated,
    }, candidates.flatMap(({ id, surface, path, matcher }) => [id, surface, path, matcher]));
    return { candidates, candidateCount, truncated, ...exported };
  },
});

export const recordEmptyScan = typedCodeStep<{
  written: true;
  artifactPath: string;
}>({
  id: "record-empty-scan",
  type: "code",
  when: (ctx) => scannedCandidates(ctx).candidateCount === 0,
  validate: (raw) =>
    expectStructuredOutput<{ written: true; artifactPath: string }>(raw, [
      "written",
      "artifactPath",
    ]),
  run: (ctx) =>
    writeSecurityReviewOutcome(ctx.workflow.runDirPath, {
      outcome: "no-op",
      reason: "empty-scan",
      candidateCount: 0,
    }),
});
