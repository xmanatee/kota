import { join } from "node:path";
import { z } from "zod";
import { typedCodeStep } from "#core/workflow/step-input-code.js";
import { classifyAgentPolicyRefusal } from "#core/workflow/steps/step-executor-retry.js";
import type { WorkflowFinalizationContext } from "#core/workflow/types.js";
import { refreshReviewInput } from "./candidate-steps.js";
import { type ReviewInputReference, refreshedReviewInputArtifact, reviewInputReferenceSchema, securityReviewArtifact } from "./review-input-artifact.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_STATE_KEY, securityReviewPathUnavailable, validateSecurityReviewState } from "./review-state.js";
import { writeJsonArtifact } from "./security-review.js";

const refusalSchema = z.object({
  outcome: z.literal("blocked"), reason: z.literal("provider-policy-refusal"),
  stepId: z.enum(["investigate-candidates", "revalidate-findings"]),
  runId: z.string().min(1), failedAt: z.string().datetime(),
  diagnostic: z.string().min(1), prerequisite: z.string().min(1),
  coverage: z.literal("unknown"),
}).strict();
const refusalArtifact = securityReviewArtifact("security-review-refusal.json", (value) => refusalSchema.parse(value));

function recordSecurityReviewFailure(stepId: z.infer<typeof refusalSchema>["stepId"]) {
  return typedCodeStep<ReviewInputReference>({
    id: `record-${stepId}-failure`, type: "code",
    when: (ctx) => ctx.stepResults[stepId]?.status === "failed",
    validate: (raw) => reviewInputReferenceSchema.parse(raw),
    run: (ctx) => {
      const failed = ctx.stepResults[stepId]!;
      const diagnostic = failed.error ?? `Security review step ${stepId} failed without a diagnostic`;
      const refusal = classifyAgentPolicyRefusal({ message: diagnostic });
      // Only a recognized provider refusal can settle as a domain blocker.
      // Transient incidents and local execution failures keep runtime recovery.
      if (!refusal) throw new Error(diagnostic);
      return refusalArtifact.write(ctx.workflow.runDirPath, {
        outcome: "blocked", reason: "provider-policy-refusal", stepId,
        runId: ctx.workflow.runId, failedAt: failed.completedAt,
        diagnostic,
        prerequisite: "Resolve the provider policy prerequisite for this review, then submit a new explicit security-review evidence request through the authorized runtime. Coverage remains unknown; preserve provider safeguards.",
        coverage: "unknown",
      });
    },
  });
}

export const recordInvestigationFailure = recordSecurityReviewFailure("investigate-candidates");
export const recordRevalidationFailure = recordSecurityReviewFailure("revalidate-findings");

export function finalizeSecurityReviewRefusal(ctx: WorkflowFinalizationContext): boolean {
  const reference = recordInvestigationFailure.output(ctx) ?? recordRevalidationFailure.output(ctx);
  if (!reference) return false;
  const runDirPath = join(ctx.stateDir, "runs", ctx.runId);
  const refusal = refusalArtifact.read(runDirPath, reference);
  const input = refreshedReviewInputArtifact.read(runDirPath, refreshReviewInput.outputRequired(ctx));
  const snapshot = ctx.state.read(SECURITY_REVIEW_STATE_KEY);
  const state = decodeSecurityReviewState(snapshot.value);
  // The provider refused the review request. Retain capped inputs as unknown
  // too, so draining another candidate batch cannot retry the same refusal.
  const paths = [...new Set([...input.changedPaths, ...input.evidencePaths])];
  state.unreviewedSurfaces = { ...state.unreviewedSurfaces, ...input.previousSurfaces };
  for (const path of paths) {
    state.unavailable[path] = {
      digest: input.contentDigests[path]!, runId: refusal.runId,
      rationale: `${refusal.diagnostic}\n${refusal.prerequisite}`,
      prerequisites: {},
      requestIds: [...new Set([
        ...securityReviewPathUnavailable(state, path, input.contentDigests, null) ? state.unavailable[path]!.requestIds : [],
        ...input.evidenceRequest?.paths.includes(path) ? [input.evidenceRequest.id] : [],
      ])],
    };
  }
  if (input.evidenceRequest && !state.evidenceRequests.some(({ request }) => request.id === input.evidenceRequest!.id)) {
    state.evidenceRequests.push({ request: input.evidenceRequest, reviewed: input.evidenceReviewed });
  }
  ctx.state.compareAndSet(SECURITY_REVIEW_STATE_KEY, snapshot.revision, validateSecurityReviewState(state));
  writeJsonArtifact(runDirPath, "security-review-outcome.json", {
    ...refusal, head: input.currentHead.sha, unknownPaths: paths,
    reviewedPaths: [], pendingFindingCount: state.pending.length,
  });
  return true;
}
