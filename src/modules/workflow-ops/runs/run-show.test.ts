import { describe, expect, it } from "vitest";
import { extractRepairSummary } from "#core/workflow/run-store-snapshot.js";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildChainNode, type ChainNode, formatRepairLine, formatWarningsSection } from "./run-show.js";

// ---------------------------------------------------------------------------
// formatWarningsSection
// ---------------------------------------------------------------------------

describe("formatWarningsSection", () => {
  it("formats a single warning", () => {
    const lines = formatWarningsSection([{ type: "output-schema-mismatch", message: "Expected string, got number at $.count" }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("  [output-schema-mismatch] Expected string, got number at $.count");
  });

  it("formats multiple warnings", () => {
    const lines = formatWarningsSection([
      { type: "output-schema-mismatch", message: "first warning" },
      { type: "other-warning", message: "second warning" },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("[output-schema-mismatch]");
    expect(lines[1]).toContain("[other-warning]");
  });

  it("returns empty array for no warnings", () => {
    expect(formatWarningsSection([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractRepairSummary
// ---------------------------------------------------------------------------

describe("extractRepairSummary", () => {
  it("returns null for null output", () => {
    expect(extractRepairSummary(null)).toBeNull();
  });

  it("returns null when repairIterations is absent", () => {
    expect(extractRepairSummary({ totalCostUsd: 0.05 })).toBeNull();
  });

  it("returns null when repairIterations is empty", () => {
    expect(extractRepairSummary({ repairIterations: [] })).toBeNull();
  });

  it("returns summary for a single repair iteration", () => {
    const output = {
      totalCostUsd: 0.03,
      repairIterations: [
        {
          attempt: 1,
          failures: [{ id: "check-lint", passed: false, output: "lint error" }],
          agentCostUsd: 0.02,
        },
      ],
    };
    const summary = extractRepairSummary(output);
    expect(summary).not.toBeNull();
    expect(summary!.attempts).toBe(1);
    expect(summary!.failedChecksByAttempt).toEqual([["check-lint"]]);
    expect(summary!.totalCostUsd).toBeCloseTo(0.02);
  });

  it("returns summary for multiple repair iterations", () => {
    const output = {
      totalCostUsd: 0.06,
      repairIterations: [
        {
          attempt: 1,
          failures: [
            { id: "check-lint", passed: false, output: "lint error" },
            { id: "check-typecheck", passed: false, output: "type error" },
          ],
          agentCostUsd: 0.01,
        },
        {
          attempt: 2,
          failures: [{ id: "check-lint", passed: false, output: "lint error" }],
          agentCostUsd: 0.02,
        },
      ],
    };
    const summary = extractRepairSummary(output);
    expect(summary).not.toBeNull();
    expect(summary!.attempts).toBe(2);
    expect(summary!.failedChecksByAttempt).toEqual([
      ["check-lint", "check-typecheck"],
      ["check-lint"],
    ]);
    expect(summary!.totalCostUsd).toBeCloseTo(0.03);
  });

  it("handles iteration with no failures (all passed in last repair)", () => {
    const output = {
      repairIterations: [
        {
          attempt: 1,
          failures: [],
          agentCostUsd: 0.01,
        },
      ],
    };
    const summary = extractRepairSummary(output);
    expect(summary).not.toBeNull();
    expect(summary!.failedChecksByAttempt).toEqual([[]]);
  });

  it("sums repair cost across iterations", () => {
    const output = {
      repairIterations: [
        { attempt: 1, failures: [], agentCostUsd: 0.01 },
        { attempt: 2, failures: [], agentCostUsd: 0.03 },
      ],
    };
    const summary = extractRepairSummary(output);
    expect(summary!.totalCostUsd).toBeCloseTo(0.04);
  });
});

// ---------------------------------------------------------------------------
// formatRepairLine
// ---------------------------------------------------------------------------

describe("formatRepairLine", () => {
  it("formats a single repair", () => {
    const line = formatRepairLine({
      attempts: 1,
      failedChecksByAttempt: [["check-lint"]],
      totalCostUsd: 0.01,
    });
    expect(line).toContain("1 repair");
    expect(line).toContain("$0.010");
    expect(line).toContain("[1] check-lint");
  });

  it("formats multiple repairs", () => {
    const line = formatRepairLine({
      attempts: 2,
      failedChecksByAttempt: [["check-lint", "check-typecheck"], ["check-lint"]],
      totalCostUsd: 0.03,
    });
    expect(line).toContain("2 repairs");
    expect(line).toContain("[1] check-lint, check-typecheck");
    expect(line).toContain("[2] check-lint");
  });

  it("omits cost when zero", () => {
    const line = formatRepairLine({
      attempts: 1,
      failedChecksByAttempt: [["check-lint"]],
      totalCostUsd: 0,
    });
    expect(line).not.toContain("$");
    expect(line).toContain("1 repair");
  });

  it("shows 'passed' when iteration had no failures", () => {
    const line = formatRepairLine({
      attempts: 1,
      failedChecksByAttempt: [[]],
      totalCostUsd: 0.01,
    });
    expect(line).toContain("[1] passed");
  });
});

// ---------------------------------------------------------------------------
// printChainTree
// ---------------------------------------------------------------------------

describe("buildChainNode", () => {
  const renderInTheme = (
    node: ChainNode,
    currentId: string,
    theme: typeof DEFAULT_THEME,
    width: number,
  ): string => renderToString(buildChainNode(node, currentId), renderContext({ theme, width }));

  it("renders a single root node marked as current", () => {
    const node: ChainNode = { id: "run-1", workflow: "builder", status: "success", durationMs: 60000, children: [] };
    const out = renderInTheme(node, "run-1", NO_COLOR_THEME, 80);
    expect(out).toContain("builder/run-1");
    expect(out).toContain("← current");
    expect(out).toContain("1m");
    expect(out.split("\n")).toHaveLength(1);
  });

  it("renders parent and child with correct connectors", () => {
    const child: ChainNode = { id: "run-2", workflow: "notifier", status: "success", durationMs: 8000, children: [] };
    const root: ChainNode = { id: "run-1", workflow: "builder", status: "success", durationMs: 252000, children: [child] };
    const out = renderInTheme(root, "run-2", NO_COLOR_THEME, 80);
    const lines = out.split("\n");
    expect(lines[0]).toContain("builder/run-1");
    expect(lines[0]).not.toContain("← current");
    const childLine = lines[1]!;
    expect(childLine).toContain("└─");
    expect(childLine).toContain("notifier/run-2");
    expect(childLine).toContain("← current");
    expect(childLine.startsWith("  ")).toBe(true);
  });

  it("uses ├─ for non-last children and └─ for last", () => {
    const child1: ChainNode = { id: "c1", workflow: "wf-a", status: "success", children: [] };
    const child2: ChainNode = { id: "c2", workflow: "wf-b", status: "failed", children: [] };
    const root: ChainNode = { id: "root", workflow: "builder", status: "success", children: [child1, child2] };
    const out = renderInTheme(root, "root", NO_COLOR_THEME, 80);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("├─");
    expect(lines[2]).toContain("└─");
  });

  it("marks no node as current when currentId does not match", () => {
    const node: ChainNode = { id: "run-1", workflow: "builder", status: "success", children: [] };
    const out = renderInTheme(node, "nonexistent", NO_COLOR_THEME, 80);
    expect(out).not.toContain("← current");
  });

  it("indents nested grandchildren under the group primitive", () => {
    const grand: ChainNode = { id: "g1", workflow: "deep", status: "success", children: [] };
    const child: ChainNode = { id: "c1", workflow: "mid", status: "success", children: [grand] };
    const root: ChainNode = { id: "root", workflow: "top", status: "success", children: [child] };
    const out = renderInTheme(root, "g1", NO_COLOR_THEME, 80);
    const lines = out.split("\n");
    expect(lines[0]).toContain("top/root");
    expect(lines[1]).toContain("mid/c1");
    expect(lines[2]).toContain("deep/g1");
    const leadingSpaces = (s: string): number => s.length - s.trimStart().length;
    expect(leadingSpaces(lines[2]!)).toBeGreaterThan(leadingSpaces(lines[1]!));
  });

  for (const { name, theme } of [
    { name: "default", theme: DEFAULT_THEME },
    { name: "ascii", theme: ASCII_THEME },
    { name: "no-color", theme: NO_COLOR_THEME },
  ]) {
    it(`renders chain tree in ${name} theme without overflowing width`, () => {
      const child: ChainNode = { id: "child-1", workflow: "notifier", status: "success", children: [] };
      const root: ChainNode = { id: "root-1", workflow: "builder", status: "success", children: [child] };
      const out = renderInTheme(root, "root-1", theme, 60);
      expect(out).toContain("builder/root-1");
      expect(out).toContain("notifier/child-1");
    });
  }
});
