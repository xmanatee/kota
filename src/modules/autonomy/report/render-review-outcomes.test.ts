import { describe, expect, it } from "vitest";
import type { ReviewOutcomeReport } from "#modules/autonomy/review-outcomes.js";
import { NO_COLOR_THEME, renderToString } from "#modules/rendering/index.js";
import { stack } from "#modules/rendering/primitives.js";
import { renderReviewOutcome } from "./render-run-sections.js";
import { emptyAutonomyReportData } from "./report-test-fixtures.js";

function render(report: ReviewOutcomeReport): string {
  return renderToString(stack(...renderReviewOutcome(report)), {
    width: 100,
    theme: NO_COLOR_THEME,
  });
}

describe("renderReviewOutcome", () => {
  it("emits a placeholder when reviewer artifacts are absent", () => {
    expect(render(emptyAutonomyReportData.reviewOutcomes)).toContain(
      "(no reviewer artifacts)",
    );
  });

  it("renders original review counts and unreadable artifacts", () => {
    const text = render({
      totalReviews: 3,
      approvalLikeDecisions: 2,
      unsupportedArtifacts: 1,
      bySurface: [
        { surface: "critic", reviews: 1, approvalLikeDecisions: 1, unsupportedArtifacts: 0 },
        { surface: "progress-reviewer", reviews: 1, approvalLikeDecisions: 1, unsupportedArtifacts: 0 },
        { surface: "pr-reviewer", reviews: 1, approvalLikeDecisions: 0, unsupportedArtifacts: 1 },
        { surface: "semantic-gate", reviews: 0, approvalLikeDecisions: 0, unsupportedArtifacts: 0 },
      ],
      records: [],
      unsupported: [
        {
          runId: "old-pr-run",
          workflow: "pr-reviewer",
          artifact: "metadata:prepare-comment",
          reason: "unsupported prepared comment shape",
        },
      ],
    });

    expect(text).toContain("Reviews: 3");
    expect(text).toContain("Approval-like: 2");
    expect(text).toContain("Unreadable artifacts: 1");
  });
});
