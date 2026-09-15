import type { PrReviewEvidence } from "#modules/github/github-pr-review.js";

export const reviewHeadSha = "a".repeat(40);

export function prReviewFixture(headBranch: string): Extract<PrReviewEvidence, { status: "ready" }> {
  return {
    status: "ready",
    repo: "owner/repo",
    number: 42,
    headSha: reviewHeadSha,
    baseSha: "b".repeat(40),
    headBranch,
    baseBranch: "main",
    title: "Add feature X",
    body: "Reject requests without an authenticated user.",
    diff: "diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-return true;\n+return user !== null;",
  };
}
