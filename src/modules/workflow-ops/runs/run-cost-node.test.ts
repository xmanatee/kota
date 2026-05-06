import { describe, expect, it } from "vitest";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildRunBreakdownNode, buildSummaryTableNode } from "./run-cost.js";

const ROWS = [
  {
    workflow: "builder",
    runs: 12,
    totalCostUsd: 1.234,
    averageCostUsd: 0.103,
    maxRunCostUsd: 0.42,
  },
  {
    workflow: "explorer",
    runs: 4,
    totalCostUsd: 0.20,
    averageCostUsd: 0.05,
    maxRunCostUsd: 0.07,
  },
];

const RUN_ENTRIES = [
  {
    id: "2026-04-20T10-00-00Z-builder-aaaa",
    workflow: "builder",
    status: "success",
    startedAt: "2026-04-20T10:00:00.000Z",
    totalCostUsd: 0.42,
  },
  {
    id: "2026-04-20T11-00-00Z-builder-bbbb",
    workflow: "builder",
    status: "failed",
    startedAt: "2026-04-20T11:00:00.000Z",
    totalCostUsd: 0.05,
  },
];

describe("buildSummaryTableNode", () => {
  for (const { name, theme } of [
    { name: "default", theme: DEFAULT_THEME },
    { name: "ascii", theme: ASCII_THEME },
    { name: "no-color", theme: NO_COLOR_THEME },
  ]) {
    it(`renders the per-workflow cost table in ${name} theme`, () => {
      const node = buildSummaryTableNode(ROWS);
      expect(node).not.toBeNull();
      const out = renderToString(node!, renderContext({ theme, width: 120 }));
      expect(out).toContain("builder");
      expect(out).toContain("explorer");
      expect(out).toContain("$1.2340");
    });
  }

  it("returns null when given an empty rows array", () => {
    expect(buildSummaryTableNode([])).toBeNull();
  });
});

describe("buildRunBreakdownNode", () => {
  it("renders one row per finished run", () => {
    const out = renderToString(
      buildRunBreakdownNode(RUN_ENTRIES),
      renderContext({ theme: NO_COLOR_THEME, width: 120 }),
    );
    expect(out).toContain("2026-04-20T10-00-00Z-builder-aaaa");
    expect(out).toContain("$0.4200");
    expect(out).toContain("success");
    expect(out).toContain("failed");
  });

  it("falls back to a no-runs message when nothing finished", () => {
    const out = renderToString(
      buildRunBreakdownNode([
        { id: "x", workflow: "builder", status: "running", startedAt: "2026-04-20T10:00:00.000Z" },
      ]),
      renderContext({ theme: NO_COLOR_THEME, width: 80 }),
    );
    expect(out).toContain("(no completed runs)");
  });
});
