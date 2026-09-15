import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { typedCodeStep } from "#core/workflow/step-input-code.js";
import { prReviewEvidenceSchema, prReviewIdentityResultSchema, prReviewIdentitySchema } from "#modules/github/github-pr-review.js";

type ReviewAssessment = { skip: true } | {
  skip: false;
  repo: string;
  prNumber: number;
  headSha: string;
  headBranch: string;
  baseBranch: string;
};

async function readPrReview(ctx: WorkflowStepContext, repo: string, number: number, headSha: string, mode: "evidence" | "identity"): Promise<unknown> {
  const result = await ctx.runTool("github_get_pr_review", { repo, number, headSha, mode });
  if (result.is_error) throw new Error(result.content);
  return JSON.parse(result.content);
}

export function createPrReviewInputStep(assessment: (ctx: WorkflowStepContext) => ReviewAssessment) {
  const input = typedCodeStep({
    id: "pr-review-input",
    type: "code",
    exposeOutputToAgent: true,
    exposedOutputTrust: "untrusted",
    rerunOnRetry: true,
    when: (ctx) => !assessment(ctx).skip,
    validate: (raw) => prReviewEvidenceSchema.parse(raw),
    run: async (ctx) => {
      const pr = assessment(ctx);
      if (pr.skip) throw new Error("Cannot collect evidence for a skipped PR");
      const evidence = prReviewEvidenceSchema.parse(await readPrReview(ctx, pr.repo, pr.prNumber, pr.headSha, "evidence"));
      if (evidence.status === "ready" && (evidence.repo !== pr.repo || evidence.number !== pr.prNumber ||
        evidence.headSha !== pr.headSha || evidence.headBranch !== pr.headBranch || evidence.baseBranch !== pr.baseBranch)) {
        return { status: "unavailable" as const, reason: "PR review identity no longer matches the event" };
      }
      return evidence;
    },
  });
  return {
    input,
    ready: (ctx: WorkflowStepContext) => input.output(ctx)?.status === "ready",
    assertCurrent: async (ctx: WorkflowStepContext): Promise<void> => {
      const reviewed = input.outputRequired(ctx);
      if (reviewed.status !== "ready") throw new Error("Cannot publish a verdict without PR evidence");
      const current = prReviewIdentityResultSchema.parse(await readPrReview(ctx, reviewed.repo, reviewed.number, reviewed.headSha, "identity"));
      if ("status" in current) throw new Error(`PR review freshness unavailable: ${current.reason}`);
      if (JSON.stringify(current) !== JSON.stringify(prReviewIdentitySchema.parse(reviewed))) {
        throw new Error("PR review evidence changed before publication; no verdict can be published");
      }
    },
  };
}
