import { describe, expect, it } from "vitest";
import { NO_COLOR_THEME, renderToString } from "#modules/rendering/index.js";
import { stack } from "#modules/rendering/primitives.js";
import type { ControlMonitorCoverageReport } from "./control-coverage-report.js";
import { renderControlCoverage } from "./render-control-coverage.js";

function render(report: ControlMonitorCoverageReport): string {
  return renderToString(stack(...renderControlCoverage(report)), {
    width: 100,
    theme: NO_COLOR_THEME,
  });
}

describe("renderControlCoverage", () => {
  it("renders an empty coverage placeholder", () => {
    expect(render({
      artifactCount: 0,
      runsWithGaps: 0,
      totalGaps: 0,
      pendingFamilies: 0,
      unsupportedFamilies: 0,
      blockedFamilies: 0,
      warnedFamilies: 0,
      asyncReviewResponseMs: {
        observations: 0,
        min: null,
        max: null,
        average: null,
      },
      topGaps: [],
      recentArtifactPaths: [],
    })).toContain("(no control coverage artifacts)");
  });

  it("renders gap counts, async reviewer timing, and recent artifacts", () => {
    const text = render({
      artifactCount: 2,
      runsWithGaps: 1,
      totalGaps: 1,
      pendingFamilies: 1,
      unsupportedFamilies: 0,
      blockedFamilies: 0,
      warnedFamilies: 0,
      asyncReviewResponseMs: {
        observations: 1,
        min: 5000,
        max: 5000,
        average: 5000,
      },
      topGaps: [
        {
          family: "injection-defense",
          reason: "external-payload-unscreened",
          severity: "error",
          count: 1,
          evidenceArtifactPaths: [".kota/runs/r1/control-monitor-coverage.json"],
        },
      ],
      recentArtifactPaths: [
        ".kota/runs/r2/control-monitor-coverage.json",
        ".kota/runs/r1/control-monitor-coverage.json",
      ],
    });

    expect(text).toContain("Artifacts: 2");
    expect(text).toContain("external-payload-unscreened");
    expect(text).toContain("avg 5000ms");
    expect(text).toContain(".kota/runs/r2/control-monitor-coverage.json");
  });
});
