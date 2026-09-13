import { describe, expect, it } from "vitest";
import { renderContext } from "#modules/rendering/render.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildChainNode, type ChainNode, formatWarningsSection } from "./run-show.js";

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
// printChainTree
// ---------------------------------------------------------------------------

describe("buildChainNode", () => {
  const renderInTheme = (
    node: ChainNode,
    currentId: string,
    theme: typeof NO_COLOR_THEME,
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

    it(`renders chain tree in no-color theme without overflowing width`, () => {
      const child: ChainNode = { id: "child-1", workflow: "notifier", status: "success", children: [] };
      const root: ChainNode = { id: "root-1", workflow: "builder", status: "success", children: [child] };
      const out = renderInTheme(root, "root-1", NO_COLOR_THEME, 60);
      expect(out).toContain("builder/root-1");
      expect(out).toContain("notifier/child-1");
    });

});
