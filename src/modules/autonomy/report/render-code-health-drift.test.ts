import { describe, expect, it } from "vitest";
import { NO_COLOR_THEME, renderToString } from "#modules/rendering/index.js";
import { stack } from "#modules/rendering/primitives.js";
import { renderCodeHealthDrift } from "./render-code-health-drift.js";

function render(report: Parameters<typeof renderCodeHealthDrift>[0]): string {
  return renderToString(stack(...renderCodeHealthDrift(report)), {
    theme: NO_COLOR_THEME,
  });
}

describe("renderCodeHealthDrift", () => {
  it("renders warning counts, repeated surfaces, coverage, and refs without cost fields", () => {
    const text = render({
      totalBuilderRuns: 3,
      runsWithWarnings: 1,
      unsupportedArtifacts: 1,
      byWarningFamily: [{ key: "source-size", count: 2 }],
      bySurfaceArea: [{ key: "module:autonomy", count: 2 }],
      trendBuckets: [
        {
          bucket: "current",
          totalBuilderRuns: 3,
          runsWithWarnings: 1,
          warningRecords: 2,
          cleanupExceptionRuns: 1,
          unsupportedArtifacts: 1,
        },
        {
          bucket: "prior",
          totalBuilderRuns: 2,
          runsWithWarnings: 1,
          warningRecords: 1,
          cleanupExceptionRuns: 0,
          unsupportedArtifacts: 0,
        },
      ],
      repeatedSurfaces: [
        {
          file: "src/modules/autonomy/report/aggregate.ts",
          warningFamily: "source-size",
          currentWarnings: 1,
          priorWarnings: 1,
          totalWarnings: 2,
          latestRunId: "2026-04-28T10-00-00-000Z-builder-current",
          cleanupCoverage: [
            {
              kind: "open-cleanup-task",
              taskId: "task-split-aggregate",
              taskTitle: "Split aggregate",
              taskState: "ready",
              files: ["src/modules/autonomy/report/aggregate.ts"],
            },
          ],
        },
      ],
      records: [
        {
          runId: "2026-04-28T10-00-00-000Z-builder-current",
          taskId: "task-report",
          commitRef: "abc123def4567890",
          changedSourceFiles: ["src/modules/autonomy/report/aggregate.ts"],
          warningFamily: "source-size",
          outcome: "warning",
          warningCount: 2,
          files: ["src/modules/autonomy/report/aggregate.ts"],
          cleanupCoverage: [],
        },
      ],
    });

    expect(text).toContain("Builder runs inspected: 3");
    expect(text).toContain("source-size");
    expect(text).toContain("module:autonomy");
    expect(text).toContain("src/modules/autonomy/report/aggregate.ts");
    expect(text).toContain("task-split-aggregate");
    expect(text).toContain("abc123def456");
    expect(text).not.toMatch(/\$|cost|throughput/i);
  });
});
