import { describe, expect, it } from "vitest";
import type { CompletionReason, DelegateMetadata } from "./delegate-format.js";
import {
  assembleDelegateResult,
  buildDelegateResult,
  buildSourcesSection,
  collectImageBlocks,
  extractModifiedFiles,
  formatMetadata,
  textHasSources,
} from "./delegate-format.js";
import type { ToolResultBlock } from "./index.js";

// --- Helpers ---

function makeMeta(overrides: Partial<DelegateMetadata> = {}): DelegateMetadata {
  return {
    mode: "explore",
    turnsUsed: 3,
    turnsMax: 10,
    toolsUsed: ["grep", "file_read"],
    completionReason: "done",
    urlsFetched: [],
    searchQueries: [],
    ...overrides,
  };
}

// --- formatMetadata ---

describe("formatMetadata", () => {
  it("formats a normal completed delegation", () => {
    const result = formatMetadata(makeMeta());
    expect(result).toBe("[explore: 3/10 turns | tools: grep, file_read]");
  });

  it("shows 'none' when no tools used", () => {
    const result = formatMetadata(makeMeta({ toolsUsed: [] }));
    expect(result).toContain("tools: none");
  });

  it("includes turn limit label", () => {
    const result = formatMetadata(makeMeta({ completionReason: "turn_limit" }));
    expect(result).toContain("hit turn limit");
  });

  it("includes circuit break label", () => {
    const result = formatMetadata(makeMeta({ completionReason: "circuit_break" }));
    expect(result).toContain("stopped: repeated errors");
  });

  it("includes context overflow label", () => {
    const result = formatMetadata(makeMeta({ completionReason: "context_overflow" }));
    expect(result).toContain("ran out of context");
  });

  it("falls back to raw reason for unknown completion reason", () => {
    const result = formatMetadata(makeMeta({ completionReason: "unknown_reason" as CompletionReason }));
    expect(result).toContain("unknown_reason");
  });

  it("includes URL count when urls fetched", () => {
    const result = formatMetadata(makeMeta({ urlsFetched: ["https://a.com", "https://b.com"] }));
    expect(result).toContain("sources: 2 URL(s)");
  });

  it("includes query count when searches made", () => {
    const result = formatMetadata(makeMeta({ searchQueries: ["rate limiting", "token bucket"] }));
    expect(result).toContain("queries: 2");
  });

  it("combines all parts for a full metadata line", () => {
    const result = formatMetadata(makeMeta({
      mode: "execute",
      turnsUsed: 15,
      turnsMax: 15,
      completionReason: "turn_limit",
      urlsFetched: ["https://docs.example.com"],
      searchQueries: ["how to X"],
    }));
    expect(result).toContain("execute: 15/15 turns");
    expect(result).toContain("hit turn limit");
    expect(result).toContain("sources: 1 URL(s)");
    expect(result).toContain("queries: 1");
  });
});

// --- buildSourcesSection ---

describe("buildSourcesSection", () => {
  it("returns empty string when no sources", () => {
    expect(buildSourcesSection([], [])).toBe("");
  });

  it("lists URLs only", () => {
    const result = buildSourcesSection(["https://a.com", "https://b.com"], []);
    expect(result).toContain("Sources (2)");
    expect(result).toContain("https://a.com");
    expect(result).toContain("https://b.com");
    expect(result).not.toContain("Search queries");
  });

  it("lists queries only", () => {
    const result = buildSourcesSection([], ["rate limiting"]);
    expect(result).toContain("Search queries (1)");
    expect(result).toContain('"rate limiting"');
    expect(result).not.toContain("Sources");
  });

  it("lists both URLs and queries", () => {
    const result = buildSourcesSection(["https://a.com"], ["query1"]);
    expect(result).toContain("Sources (1)");
    expect(result).toContain("Search queries (1)");
  });

  it("starts with double newline for separation", () => {
    const result = buildSourcesSection(["https://a.com"], []);
    expect(result).toMatch(/^\n\n/);
  });
});

// --- buildDelegateResult ---

describe("buildDelegateResult", () => {
  it("returns text-only result when no images", () => {
    const result = buildDelegateResult("Hello world", []);
    expect(result).toEqual({ content: "Hello world" });
    expect(result).not.toHaveProperty("blocks");
  });

  it("includes blocks when images present", () => {
    const img: ToolResultBlock = { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } };
    const result = buildDelegateResult("Analysis result", [img]);
    expect(result.content).toBe("Analysis result");
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks![0]).toEqual({ type: "text", text: "Analysis result" });
    expect(result.blocks![1]).toBe(img);
  });
});

// --- collectImageBlocks ---

describe("collectImageBlocks", () => {
  const makeImg = (id: string): ToolResultBlock => ({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: id },
  });

  it("returns existing blocks when results have no blocks", () => {
    const existing = [makeImg("1")];
    const result = collectImageBlocks([{ blocks: undefined }, {}], existing, 5);
    expect(result).toEqual(existing);
  });

  it("collects image blocks from results", () => {
    const result = collectImageBlocks(
      [{ blocks: [makeImg("a"), makeImg("b")] }],
      [],
      5,
    );
    expect(result).toHaveLength(2);
  });

  it("respects max limit", () => {
    const result = collectImageBlocks(
      [{ blocks: [makeImg("a"), makeImg("b"), makeImg("c")] }],
      [],
      2,
    );
    expect(result).toHaveLength(2);
  });

  it("counts existing blocks toward max", () => {
    const result = collectImageBlocks(
      [{ blocks: [makeImg("a"), makeImg("b")] }],
      [makeImg("existing")],
      2,
    );
    expect(result).toHaveLength(2); // 1 existing + 1 new
  });

  it("skips non-image blocks", () => {
    const textBlock: ToolResultBlock = { type: "text", text: "hello" };
    const result = collectImageBlocks(
      [{ blocks: [textBlock, makeImg("a")] }],
      [],
      5,
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("image");
  });
});

// --- extractModifiedFiles ---

describe("extractModifiedFiles", () => {
  it("extracts path from file_edit", () => {
    expect(extractModifiedFiles("file_edit", { path: "src/foo.ts" })).toEqual(["src/foo.ts"]);
  });

  it("extracts path from file_write", () => {
    expect(extractModifiedFiles("file_write", { path: "out.txt" })).toEqual(["out.txt"]);
  });

  it("returns empty for file_edit with no path", () => {
    expect(extractModifiedFiles("file_edit", {})).toEqual([]);
  });

  it("extracts paths from multi_edit", () => {
    const input = {
      edits: [
        { path: "a.ts" },
        { file_path: "b.ts" },
        { path: "c.ts", file_path: "d.ts" }, // path takes priority
      ],
    };
    expect(extractModifiedFiles("multi_edit", input)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("returns empty for multi_edit with no edits array", () => {
    expect(extractModifiedFiles("multi_edit", {})).toEqual([]);
  });

  it("filters out empty paths from multi_edit", () => {
    const input = { edits: [{ path: "a.ts" }, {}, { path: "" }] };
    expect(extractModifiedFiles("multi_edit", input)).toEqual(["a.ts"]);
  });

  it("extracts paths from find_replace result content", () => {
    const content = "Replaced 5 occurrences across 2 files:\n  src/foo.ts: 3 replacements\n  src/bar.ts: 2 replacements";
    expect(extractModifiedFiles("find_replace", {}, content)).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("returns empty for find_replace that did not start with Replaced", () => {
    expect(extractModifiedFiles("find_replace", {}, "No matches found")).toEqual([]);
  });

  it("returns empty for unknown tool names", () => {
    expect(extractModifiedFiles("grep", { pattern: "foo" })).toEqual([]);
  });
});

// --- assembleDelegateResult (cross-module integration) ---

describe("assembleDelegateResult", () => {
  it("assembles a standard explore result", () => {
    const meta = makeMeta({ urlsFetched: ["https://docs.example.com"] });
    const result = assembleDelegateResult("Found 3 relevant patterns.", meta, new Set(), []);
    expect(result.content).toContain("[explore: 3/10 turns");
    expect(result.content).toContain("Found 3 relevant patterns.");
    expect(result.content).toContain("https://docs.example.com");
  });

  it("handles empty response with no modified files", () => {
    const result = assembleDelegateResult("", makeMeta(), new Set(), []);
    expect(result.content).toContain("Sub-agent completed without producing a response.");
  });

  it("handles execute mode with modified files", () => {
    const meta = makeMeta({ mode: "execute" });
    const modified = new Set(["src/a.ts", "src/b.ts"]);
    const result = assembleDelegateResult("Fixed the bug.", meta, modified, []);
    expect(result.content).toContain("Modified files (2)");
    expect(result.content).toContain("- src/a.ts");
    expect(result.content).toContain("- src/b.ts");
    expect(result.content).toContain("Fixed the bug.");
  });

  it("uses '(no summary)' for execute with files but no text", () => {
    const meta = makeMeta({ mode: "execute" });
    const result = assembleDelegateResult("", meta, new Set(["x.ts"]), []);
    expect(result.content).toContain("(no summary)");
    expect(result.content).toContain("Modified files (1)");
  });

  it("uses '(no output)' for explore with empty text", () => {
    // empty text but with some modified files (shouldn't happen in explore but tests the else branch)
    const meta = makeMeta({ mode: "explore" });
    const result = assembleDelegateResult("", meta, new Set(["x.ts"]), []);
    // explore mode doesn't list modified files — goes to the else branch
    expect(result.content).toContain("(no output)");
  });

  it("includes images in result when present", () => {
    const img: ToolResultBlock = { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } };
    const result = assembleDelegateResult("Chart analysis.", makeMeta(), new Set(), [img]);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks![0]).toHaveProperty("type", "text");
    expect(result.blocks![1]).toBe(img);
  });

  it("includes sources section with search queries and URLs", () => {
    const meta = makeMeta({
      urlsFetched: ["https://a.com"],
      searchQueries: ["rate limiting strategies"],
    });
    const result = assembleDelegateResult("Summary.", meta, new Set(), []);
    expect(result.content).toContain("Sources (1)");
    expect(result.content).toContain("Search queries (1)");
    expect(result.content).toContain('"rate limiting strategies"');
  });

  it("handles turn limit with sources for research follow-up scenario", () => {
    const meta = makeMeta({
      completionReason: "turn_limit",
      turnsUsed: 10,
      turnsMax: 10,
      urlsFetched: ["https://docs.example.com"],
      searchQueries: ["token bucket algorithm"],
    });
    const result = assembleDelegateResult("Partial findings...", meta, new Set(), []);
    expect(result.content).toContain("hit turn limit");
    expect(result.content).toContain("Partial findings...");
    expect(result.content).toContain("Sources (1)");
  });

  it("skips metadata sources when sub-agent text already has a sources section", () => {
    const subAgentText = [
      "## Executive Summary",
      "Asana is best for large teams.",
      "",
      "## Sources",
      "- https://asana.com/pricing (2025-12)",
      "- https://linear.app/pricing (2025-11)",
    ].join("\n");
    const meta = makeMeta({
      urlsFetched: ["https://asana.com/pricing", "https://linear.app/pricing"],
      searchQueries: ["project management tool comparison"],
    });
    const result = assembleDelegateResult(subAgentText, meta, new Set(), []);
    // Should NOT have the metadata "--- Sources (2) ---" section
    expect(result.content).not.toContain("--- Sources (2) ---");
    // But should still append search queries
    expect(result.content).toContain("Search queries (1)");
    expect(result.content).toContain('"project management tool comparison"');
  });

  it("still appends metadata sources when sub-agent text has no sources section", () => {
    const subAgentText = "Asana costs $10.99/user/month for Premium.";
    const meta = makeMeta({
      urlsFetched: ["https://asana.com/pricing"],
      searchQueries: [],
    });
    const result = assembleDelegateResult(subAgentText, meta, new Set(), []);
    expect(result.content).toContain("--- Sources (1) ---");
    expect(result.content).toContain("https://asana.com/pricing");
  });

  it("handles sub-agent text with markdown references section", () => {
    const subAgentText = [
      "Analysis complete.",
      "",
      "### References",
      "- https://docs.example.com/api",
    ].join("\n");
    const meta = makeMeta({
      urlsFetched: ["https://docs.example.com/api"],
    });
    const result = assembleDelegateResult(subAgentText, meta, new Set(), []);
    expect(result.content).not.toContain("--- Sources (1) ---");
  });

  it("appends sources for empty response even if keyword 'source' appears", () => {
    // Empty lastText should always get metadata sources
    const meta = makeMeta({
      urlsFetched: ["https://example.com"],
    });
    const result = assembleDelegateResult("", meta, new Set(), []);
    expect(result.content).toContain("--- Sources (1) ---");
  });
});

// --- textHasSources ---

describe("textHasSources", () => {
  it("returns false for empty text", () => {
    expect(textHasSources("")).toBe(false);
  });

  it("detects markdown heading with sources and URLs", () => {
    const text = "## Sources\n- https://example.com\n- https://other.com";
    expect(textHasSources(text)).toBe(true);
  });

  it("detects references heading with URLs", () => {
    const text = "### References\nhttps://docs.example.com";
    expect(textHasSources(text)).toBe(true);
  });

  it("detects dashed source heading", () => {
    const text = "--- Sources ---\n  https://a.com";
    expect(textHasSources(text)).toBe(true);
  });

  it("returns false when source heading has no URLs nearby", () => {
    const text = "## Sources\nNo sources were found for this query.";
    expect(textHasSources(text)).toBe(false);
  });

  it("returns false for plain text mentioning 'source' without heading format", () => {
    const text = "The source of truth is the database. See https://example.com";
    expect(textHasSources(text)).toBe(false);
  });

  it("detects 'Resources' heading with URLs", () => {
    const text = "## Resources\n- https://example.com/guide\n- https://other.com/docs";
    expect(textHasSources(text)).toBe(true);
  });

  it("detects bold markdown source heading with URLs", () => {
    const text = "**Sources**\n- https://example.com";
    expect(textHasSources(text)).toBe(true);
  });

  it("detects sources section far from end of text", () => {
    const text = [
      "# Analysis",
      "Lots of findings here.",
      "",
      "## Sources",
      "- https://a.com",
      "- https://b.com",
      "",
      "## Appendix",
      "Additional notes follow.",
    ].join("\n");
    expect(textHasSources(text)).toBe(true);
  });

  it("returns false for numbered list without heading marker", () => {
    const text = "1. Source code at https://github.com/foo/bar";
    expect(textHasSources(text)).toBe(false);
  });
});

// --- Cross-module: assembleDelegateResult + textHasSources edge cases ---

describe("assembleDelegateResult source dedup edge cases", () => {
  it("deduplicates when sub-agent uses Resources heading", () => {
    const text = [
      "Trail recommendations for Patagonia.",
      "",
      "## Resources",
      "- https://patagonia-trails.com",
      "- https://weather.gov/patagonia",
    ].join("\n");
    const meta = makeMeta({
      urlsFetched: ["https://patagonia-trails.com", "https://weather.gov/patagonia"],
      searchQueries: ["patagonia hiking trails december"],
    });
    const result = assembleDelegateResult(text, meta, new Set(), []);
    expect(result.content).not.toContain("--- Sources (2) ---");
    expect(result.content).toContain("Search queries (1)");
  });

  it("deduplicates in execute mode with modified files and embedded sources", () => {
    const text = [
      "Updated the config file.",
      "",
      "### References",
      "- https://docs.example.com/config",
    ].join("\n");
    const meta = makeMeta({
      mode: "execute",
      urlsFetched: ["https://docs.example.com/config"],
      searchQueries: [],
    });
    const modified = new Set(["config.yaml"]);
    const result = assembleDelegateResult(text, meta, modified, []);
    expect(result.content).toContain("Modified files (1)");
    expect(result.content).toContain("- config.yaml");
    expect(result.content).not.toContain("--- Sources (1) ---");
  });

  it("appends full sources when sub-agent mentions source in prose only", () => {
    const text = "According to the source documentation, the API uses OAuth2.";
    const meta = makeMeta({
      urlsFetched: ["https://api.example.com/docs"],
    });
    const result = assembleDelegateResult(text, meta, new Set(), []);
    expect(result.content).toContain("--- Sources (1) ---");
    expect(result.content).toContain("https://api.example.com/docs");
  });
});
