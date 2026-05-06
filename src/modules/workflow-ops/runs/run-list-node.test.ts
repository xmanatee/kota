import { describe, expect, it } from "vitest";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildHistoryNode, buildRunListNode } from "./run-list.js";

const RUNS = [
  {
    id: "2026-04-20T10-00-00Z-builder-aaaa",
    workflow: "builder",
    status: "success",
    durationMs: 252_000,
    totalCostUsd: 0.123,
    startedAt: "2026-04-20T10:00:00.000Z",
    trigger: { event: "autonomy.queue.available" },
  },
  {
    id: "2026-04-20T10-05-00Z-dispatcher-bbbb",
    workflow: "dispatcher",
    status: "failed",
    durationMs: 8_400,
    totalCostUsd: 0.012,
    startedAt: "2026-04-20T10:05:00.000Z",
    trigger: { event: "runtime.idle" },
    tags: ["repair"],
  },
];

describe("buildRunListNode", () => {
  for (const { name, theme } of [
    { name: "default", theme: DEFAULT_THEME },
    { name: "ascii", theme: ASCII_THEME },
    { name: "no-color", theme: NO_COLOR_THEME },
  ]) {
    it(`renders id/workflow/status/cost columns in ${name} theme at wide width`, () => {
      const out = renderToString(
        buildRunListNode(RUNS),
        renderContext({ theme, width: 140 }),
      );
      expect(out).toContain("builder");
      expect(out).toContain("dispatcher");
      expect(out).toContain("Workflow");
      expect(out).toContain("Trigger");
    });

    it(`fits within a narrow terminal width in ${name} theme`, () => {
      const out = renderToString(
        buildRunListNode(RUNS),
        renderContext({ theme, width: 60 }),
      );
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping
      const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
      for (const raw of out.split("\n")) {
        expect(stripAnsi(raw).length).toBeLessThanOrEqual(60);
      }
    });
  }
});

const HISTORY_ROWS = [
  {
    name: "builder",
    stats: {
      total: 12,
      successes: 10,
      failures: 2,
      interrupted: 0,
      totalCostUsd: 1.234,
      successRate: 83.3,
      avgCostUsd: 0.103,
      avgDurationMs: 320_000,
      p95DurationMs: 480_000,
    },
  },
  {
    name: "dispatcher",
    stats: {
      total: 50,
      successes: 50,
      failures: 0,
      interrupted: 0,
      totalCostUsd: 0,
      successRate: 100,
      avgCostUsd: 0,
      avgDurationMs: 1500,
      p95DurationMs: 4_000,
    },
  },
];

describe("buildHistoryNode", () => {
  it("renders workflow / runs / cost / duration columns", () => {
    const out = renderToString(
      buildHistoryNode(HISTORY_ROWS, null, 7, 62),
      renderContext({ theme: NO_COLOR_THEME, width: 120 }),
    );
    expect(out).toContain("builder");
    expect(out).toContain("dispatcher");
    expect(out).toContain("Workflow");
    expect(out).toContain("(7-day window, 62 completed runs)");
  });
});
