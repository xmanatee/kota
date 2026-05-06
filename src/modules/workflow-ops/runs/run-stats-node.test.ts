import { describe, expect, it } from "vitest";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildStatsNode } from "./run-stats.js";

const ROWS = [
  {
    workflow: "builder",
    runs: 8,
    successes: 6,
    failures: 2,
    avgDurationMs: 240_000,
    totalCostUsd: 0.84,
  },
  {
    workflow: "dispatcher",
    runs: 60,
    successes: 60,
    failures: 0,
    avgDurationMs: 1200,
    totalCostUsd: 0,
  },
];

describe("buildStatsNode", () => {
  for (const { name, theme } of [
    { name: "default", theme: DEFAULT_THEME },
    { name: "ascii", theme: ASCII_THEME },
    { name: "no-color", theme: NO_COLOR_THEME },
  ]) {
    it(`renders headings + per-workflow rows in ${name} theme at wide width`, () => {
      const out = renderToString(
        buildStatsNode(ROWS, 7),
        renderContext({ theme, width: 120 }),
      );
      expect(out).toContain("Workflow");
      expect(out).toContain("builder");
      expect(out).toContain("dispatcher");
      expect(out).toContain("(7-day window)");
    });
  }

  it("compresses cleanly in a narrow terminal width", () => {
    const out = renderToString(
      buildStatsNode(ROWS, 1),
      renderContext({ theme: NO_COLOR_THEME, width: 60 }),
    );
    for (const raw of out.split("\n")) {
      expect(raw.length).toBeLessThanOrEqual(60);
    }
  });
});
