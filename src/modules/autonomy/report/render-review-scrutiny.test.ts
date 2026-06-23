import { describe, expect, it } from "vitest";
import type { ReviewScrutinyReport } from "#modules/autonomy/review-scrutiny.js";
import { NO_COLOR_THEME, renderToString } from "#modules/rendering/index.js";
import { stack } from "#modules/rendering/primitives.js";
import { renderReviewScrutiny } from "./render-run-sections.js";
import { emptyAutonomyReportData } from "./report-test-fixtures.js";

function render(report: ReviewScrutinyReport): string {
  return renderToString(stack(...renderReviewScrutiny(report)), {
    width: 100,
    theme: NO_COLOR_THEME,
  });
}

describe("renderReviewScrutiny", () => {
  it("emits a placeholder when reviewer artifacts are absent", () => {
    expect(render(emptyAutonomyReportData.reviewScrutiny)).toContain(
      "(no reviewer artifacts)",
    );
  });

  it("renders reviewer counts and thin acceptance refs", () => {
    const text = render({
      totalReviews: 3,
      approvalLikeDecisions: 2,
      thinAcceptances: 1,
      absentMetricCount: 6,
      unsupportedArtifacts: 1,
      bySurface: [
        { surface: "critic", reviews: 1, approvalLikeDecisions: 1, thinAcceptances: 1, absentMetricCount: 4, unsupportedArtifacts: 0 },
        { surface: "progress-reviewer", reviews: 1, approvalLikeDecisions: 1, thinAcceptances: 0, absentMetricCount: 2, unsupportedArtifacts: 0 },
        { surface: "pr-reviewer", reviews: 1, approvalLikeDecisions: 0, thinAcceptances: 0, absentMetricCount: 0, unsupportedArtifacts: 1 },
        { surface: "semantic-gate", reviews: 0, approvalLikeDecisions: 0, thinAcceptances: 0, absentMetricCount: 0, unsupportedArtifacts: 0 },
      ],
      thinAcceptanceRefs: [
        {
          runId: "builder-run",
          workflow: "builder",
          surface: "critic",
          decision: "pass",
          artifact: "critic-review.json",
        },
      ],
      absentMetricRefs: [
        {
          runId: "builder-run",
          workflow: "builder",
          surface: "critic",
          artifact: "critic-review.json",
          metrics: [
            "evidenceIdCount",
            "findingCount",
            "followUpTaskCount",
            "citedFileLineCount",
          ],
        },
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
    expect(text).toContain("Absent metrics: 6");
    expect(text).toContain("Unsupported: 1");
    expect(text).toContain("Absent metric refs");
    expect(text).toContain("Thin acceptance refs");
    expect(text).toContain("builder-run");
  });
});
