import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import {
  securityReviewCandidateScanOperation,
} from "./blocking-operations.js";
import { collectSecurityReviewGitEvidence, type SecurityReviewGitEvidence } from "./due-check.js";
import { decodeSecurityReviewState, type EvidenceRequest, evidenceRequestSchema, SECURITY_REVIEW_STATE_KEY, type SecurityReviewState } from "./review-state.js";
import {
  type SecurityReviewCandidate,
  type SecurityReviewCandidatePacket,
  writeSecurityReviewOutcome,
} from "./security-review.js";
import { writeJsonArtifact } from "./security-review-candidates.js";

type AgentCandidate = Omit<SecurityReviewCandidate, "excerpt">;
type AgentCandidatePacket = Pick<
  SecurityReviewCandidatePacket,
  "artifactPath" | "candidateCount" | "truncated"
> & {
  candidates: AgentCandidate[];
  head: string;
  evidenceRequest: EvidenceRequest | null;
  evidenceReviewed: Record<string, string>;
  contentDigests: Record<string, string>;
};

// This ordinary code-step output is replayed by the runtime on retry. Only
// identity is retained; the scan below refreshes content at the execution head.
export const retainReviewInput = typedCodeStep<{
  evidenceRequest: EvidenceRequest | null;
  unreviewedSurfaces: SecurityReviewState["unreviewedSurfaces"];
}>({
  id: "retain-review-input",
  type: "code",
  validate: (raw) => expectStructuredOutput(raw, ["evidenceRequest", "unreviewedSurfaces"]),
  run: async ({ workspaceRoot, scopeRoot, stateDir, state, runCommand, trigger }) => {
    const reviewState = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
    const request = trigger.payload.evidence === undefined
      ? [...reviewState.evidenceRequests].sort((a, b) => Number(b.request.critical) - Number(a.request.critical))[0]?.request ?? null
      : evidenceRequestSchema.parse(trigger.payload.evidence);
    const evidenceRequest = request && !reviewState.reviewedEvidenceIds.includes(request.id) ? request : null;
    const git = await collectSecurityReviewGitEvidence({ workspaceRoot, scopeRoot, stateDir, runCommand,
      reviewState, evidencePaths: evidenceRequest?.paths,
    });
    if (git.currentHead.kind !== "commit") throw new Error("Security review requires a readable pinned Git head");
    const unreviewedSurfaces = { ...git.previousSurfaces };
    for (const path of evidenceRequest?.paths ?? []) {
      unreviewedSurfaces[path] = [...new Set([...unreviewedSurfaces[path] ?? [], "reported-boundary" as const])];
    }
    return { evidenceRequest, unreviewedSurfaces };
  },
});

export const refreshReviewInput = typedCodeStep<SecurityReviewGitEvidence & {
  evidenceRequest: EvidenceRequest | null;
  evidenceReviewed: Record<string, string>;
  evidencePaths: string[];
}>({
  id: "refresh-review-input",
  type: "code",
  rerunOnRetry: true,
  validate: (raw) => expectStructuredOutput(raw, ["currentHead", "contentDigests", "previousSurfaces", "evidenceRequest", "evidenceReviewed", "evidencePaths"]),
  run: async (ctx) => {
    const { workspaceRoot, scopeRoot, stateDir, state, runCommand } = ctx;
    const reviewState = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
    const retained = retainReviewInput.outputRequired(ctx);
    const evidenceRequest = retained.evidenceRequest && !reviewState.reviewedEvidenceIds.includes(retained.evidenceRequest.id)
      ? retained.evidenceRequest : null;
    for (const [path, surfaces] of Object.entries(retained.unreviewedSurfaces)) {
      reviewState.unreviewedSurfaces[path] = [...new Set([...reviewState.unreviewedSurfaces[path] ?? [], ...surfaces])];
    }
    const git = await collectSecurityReviewGitEvidence({ workspaceRoot, scopeRoot, stateDir, runCommand,
      reviewState, evidencePaths: evidenceRequest?.paths,
    });
    if (git.currentHead.kind !== "commit") throw new Error("Security review requires a readable pinned Git head");
    const evidenceReviewed = Object.fromEntries(Object.entries(
      reviewState.evidenceRequests.find((entry) => entry.request.id === evidenceRequest?.id)?.reviewed ?? {},
    ).filter(([path, digest]) => git.contentDigests[path] === digest));
    const evidencePaths = evidenceRequest?.paths.filter((path) => evidenceReviewed[path] === undefined) ?? [];
    writeJsonArtifact(ctx.workflow.runDirPath, "security-review-input.json", git);
    return { ...git, evidenceRequest, evidenceReviewed, evidencePaths };
  },
});

export const scanCandidates = typedCodeStep<AgentCandidatePacket>({
  id: "scan-candidates",
  type: "code",
  exposeOutputToAgent: true,
  validate: (raw) => expectStructuredOutput<AgentCandidatePacket>(raw, [
    "candidates", "candidateCount", "artifactPath", "truncated",
    "head", "contentDigests", "evidenceRequest", "evidenceReviewed",
  ]),
  run: async (ctx) => {
    const { workspaceRoot, trigger, workflow, runBlocking } = ctx;
    const git = refreshReviewInput.outputRequired(ctx);
    const { evidenceRequest, evidenceReviewed, evidencePaths } = git;
    if (git.currentHead.kind !== "commit") throw new Error("Security review requires a readable pinned Git head");
    const packet = await runBlocking(securityReviewCandidateScanOperation, {
      workspaceRoot,
      paths: [...new Set([...evidencePaths, ...git.changedPaths])],
      evidencePaths,
      previousSurfaces: git.previousSurfaces,
      runDirPath: workflow.runDirPath,
      trigger: { event: trigger.event, payload: trigger.payload },
    });
    if (packet.candidates.some((candidate) => git.contentDigests[candidate.path] === undefined)) throw new Error("Security candidate is outside the pinned Git input");
    return {
      head: git.currentHead.sha,
      evidenceRequest,
      evidenceReviewed,
      contentDigests: Object.fromEntries(packet.candidates.map((candidate) => [candidate.path, git.contentDigests[candidate.path]!])),
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
    };
  },
});

export const recordEmptyScan = typedCodeStep<{
  written: true;
  artifactPath: string;
}>({
  id: "record-empty-scan",
  type: "code",
  when: (ctx) => scanCandidates.output(ctx)?.candidateCount === 0,
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
