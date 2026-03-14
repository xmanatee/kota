import { describe, it, expect } from "vitest";
import {
  formatMetadata,
  buildSourcesSection,
  buildDelegateResult,
  collectImageBlocks,
  extractModifiedFiles,
  assembleDelegateResult,
} from "./delegate-format.js";
import type { DelegateMetadata, CompletionReason } from "./delegate-format.js";
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
});
