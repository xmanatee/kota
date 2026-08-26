import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { TypedCodeStepInput } from "#core/workflow/step-input-code.js";
import type {
  ShadowSemanticReviewStepResult,
} from "#modules/autonomy/shadow-semantic-review.js";
import {
  createShadowSemanticReviewStep,
  shadowSemanticReviewTargetOperation,
} from "#modules/autonomy/shadow-semantic-review.js";
import type { ShadowSemanticReviewTargetResolution } from "#modules/autonomy/shadow-semantic-review-types.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import type {
  MarkAttemptResult,
  ResearchRetryCapability,
  ResearchRetryMarker,
  ResearchRetrySkipReason,
} from "./precondition.js";

export type CandidateSummary = {
  id: string;
  updatedAt: string;
  urls: string[];
};

export type ExaminedCandidate = {
  id: string;
  fingerprint: string;
  marker: ResearchRetryMarker | null;
  skipReason: ResearchRetrySkipReason;
};

export type InspectResult = {
  dirty: boolean;
  candidateCount: number;
  capability: ResearchRetryCapability;
  candidate: CandidateSummary | null;
  fingerprint: string | null;
  marker: ResearchRetryMarker | null;
  examined: ExaminedCandidate[];
};

export function createResearchRetryShadowReviewStep(args: {
  inspectCandidates: TypedCodeStepInput<InspectResult>;
  markAttempt: TypedCodeStepInput<MarkAttemptResult>;
}): TypedCodeStepInput<ShadowSemanticReviewStepResult> {
  return createShadowSemanticReviewStep({
    id: "shadow-semantic-review",
    declaration: {
      id: "research-retry-source-decision",
      mode: "advisory",
      targetKind: "source-decision",
      promotionCandidateRef:
        "task-run-shadow-semantic-reviewers-for-non-builder-auto#research-retry",
      reviewer: {
        id: "source-decision-shadow-reviewer-v1",
        systemPrompt:
          "You are an advisory semantic reviewer for KOTA source-decision workflows. Judge only the declared artifacts. Do not inspect hidden reasoning, unrelated files, broad run logs, or conversation state.",
        question:
          "Does this research-retry result honestly map every attempted source to local task state, avoid duplicate follow-up work, and preserve inaccessible-source blockers without speculation?",
        maxTurns: 6,
      },
      targetResolver: (ctx) => resolveResearchRetryShadowTarget(ctx, args),
    },
  });
}

async function resolveResearchRetryShadowTarget(
  ctx: WorkflowStepContext,
  steps: {
    inspectCandidates: TypedCodeStepInput<InspectResult>;
    markAttempt: TypedCodeStepInput<MarkAttemptResult>;
  },
): Promise<ShadowSemanticReviewTargetResolution> {
  const inspection = steps.inspectCandidates.output(ctx);
  if (!inspection?.candidate) {
    return {
      kind: "skip",
      reason: "Research-retry had no selected source-decision target.",
      citedArtifacts: ["metadata:inspect-candidates"],
    };
  }
  if (!stepSucceeded("retry")(ctx)) {
    return {
      kind: "skip",
      reason: "Research-retry target unavailable because the retry step did not succeed.",
      citedArtifacts: ["metadata:retry"],
    };
  }
  const mutationArtifacts = await withWorkflowBlockingOperation(ctx).runBlocking(
    shadowSemanticReviewTargetOperation,
    {
      kind: "workflow-mutations",
      workspaceRoot: ctx.workspaceRoot,
    },
  );
  return {
    kind: "target",
    target: {
      id: inspection.candidate.id,
      kind: "source-decision",
      summary:
        "Review whether the research retry outcome maps each source to an honest local decision, avoids duplicate tasks, and preserves blockers accurately.",
      artifacts: [
        {
          path: "metadata:inspect-candidates",
          content: JSON.stringify({
            candidate: inspection.candidate,
            fingerprint: inspection.fingerprint,
            marker: inspection.marker,
            examined: inspection.examined,
          }, null, 2),
        },
        {
          path: "metadata:mark-attempt",
          content: JSON.stringify(steps.markAttempt.output(ctx) ?? null, null, 2),
        },
        ...mutationArtifacts,
      ],
    },
  };
}
