import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runDelegate, setDelegateConfig } from "./delegate.js";

vi.mock("#core/model/model-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#core/model/model-client.js")>();
  return {
    ...actual,
    createModelClient: vi.fn(() => ({
      client: {
        messages: {
          stream: vi.fn(),
          create: vi.fn(),
        },
      },
      model: "claude-sonnet-4-6",
      providerName: "anthropic",
    })),
  };
});

import type { DelegateMetadata } from "./delegate-format.js";
import { assembleDelegateResult, buildDelegateResult, buildSourcesSection, collectImageBlocks, extractModifiedFiles, formatMetadata } from "./delegate-format.js";
import type { ToolResultBlock } from "./index.js";

describe("runDelegate input validation", () => {
  it("rejects missing task", async () => {
    const result = await runDelegate({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("task is required");
  });

  it("rejects empty string task", async () => {
    const result = await runDelegate({ task: "" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("task is required");
  });

  it("rejects whitespace-only task", async () => {
    const result = await runDelegate({ task: "   " });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("task is required");
  });

  it("rejects tab/newline-only task", async () => {
    const result = await runDelegate({ task: "\n\t\r " });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("task is required");
  });

  it("rejects invalid mode", async () => {
    const result = await runDelegate({ task: "do something", mode: "invalid" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('mode must be "explore", "execute", or "research"');
  });

  it("accepts research mode without error", async () => {
    // research mode is valid — this will fail on API call (no client configured)
    // but should NOT fail on validation
    const result = await runDelegate({ task: "research something", mode: "research" });
    // If it fails, it should be an API/client error, not a validation error
    if (result.is_error) {
      expect(result.content).not.toContain("mode must be");
    }
  });
});

describe("extractModifiedFiles", () => {
  it("extracts path from file_edit", () => {
    expect(extractModifiedFiles("file_edit", { path: "src/foo.ts" })).toEqual([
      "src/foo.ts",
    ]);
  });

  it("extracts path from file_write", () => {
    expect(
      extractModifiedFiles("file_write", { path: "src/bar.ts" }),
    ).toEqual(["src/bar.ts"]);
  });

  it("returns empty for file_edit without path", () => {
    expect(extractModifiedFiles("file_edit", {})).toEqual([]);
  });

  it("extracts paths from multi_edit", () => {
    const input = {
      edits: [
        { path: "src/a.ts", old_string: "x", new_string: "y" },
        { path: "src/b.ts", old_string: "a", new_string: "b" },
      ],
    };
    expect(extractModifiedFiles("multi_edit", input)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("handles multi_edit with file_path field", () => {
    const input = {
      edits: [{ file_path: "src/c.ts", old_string: "x", new_string: "y" }],
    };
    expect(extractModifiedFiles("multi_edit", input)).toEqual(["src/c.ts"]);
  });

  it("filters empty paths from multi_edit", () => {
    const input = {
      edits: [
        { path: "src/a.ts", old_string: "x", new_string: "y" },
        { old_string: "a", new_string: "b" },
      ],
    };
    expect(extractModifiedFiles("multi_edit", input)).toEqual(["src/a.ts"]);
  });

  it("returns empty for multi_edit without edits", () => {
    expect(extractModifiedFiles("multi_edit", {})).toEqual([]);
  });

  it("returns empty for read-only tools", () => {
    expect(extractModifiedFiles("file_read", { path: "src/x.ts" })).toEqual(
      [],
    );
    expect(extractModifiedFiles("grep", { pattern: "foo" })).toEqual([]);
    expect(extractModifiedFiles("glob", { pattern: "*.ts" })).toEqual([]);
    expect(extractModifiedFiles("shell", { command: "ls" })).toEqual([]);
  });

  it("extracts paths from find_replace result content", () => {
    const result =
      "Replaced 5 occurrence(s) in 2 file(s):\n" +
      "  src/foo.ts: 3 replacement(s)\n" +
      "  src/bar.ts: 2 replacement(s)";
    expect(
      extractModifiedFiles("find_replace", { files: "src/**/*.ts" }, result),
    ).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("returns empty for find_replace dry run", () => {
    const result =
      "Dry run — 5 match(es) in 2 file(s):\n" +
      "  src/foo.ts: 3 match(es)\n" +
      "  src/bar.ts: 2 match(es)";
    expect(
      extractModifiedFiles("find_replace", { files: "src/**/*.ts" }, result),
    ).toEqual([]);
  });

  it("returns empty for find_replace without result content", () => {
    expect(
      extractModifiedFiles("find_replace", { files: "src/**/*.ts" }),
    ).toEqual([]);
  });

  it("returns empty for find_replace with no matches", () => {
    const result = 'No matches for "foo" in files matching src/**/*.ts';
    expect(
      extractModifiedFiles("find_replace", { files: "src/**/*.ts" }, result),
    ).toEqual([]);
  });
});

const img = (id: string): ToolResultBlock => ({
  type: "image",
  source: { type: "base64", media_type: "image/png", data: id },
});

describe("buildDelegateResult", () => {
  it("returns text-only when no images", () => {
    const result = buildDelegateResult("hello", []);
    expect(result).toEqual({ content: "hello" });
    expect(result.blocks).toBeUndefined();
  });

  it("returns blocks with text + images when images present", () => {
    const images = [img("abc123")];
    const result = buildDelegateResult("summary", images);
    expect(result.content).toBe("summary");
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks![0]).toEqual({ type: "text", text: "summary" });
    expect(result.blocks![1]).toEqual(img("abc123"));
  });

  it("includes multiple images in blocks", () => {
    const images = [img("a"), img("b"), img("c")];
    const result = buildDelegateResult("report", images);
    expect(result.blocks).toHaveLength(4); // 1 text + 3 images
    expect(result.blocks![0]).toEqual({ type: "text", text: "report" });
  });
});

describe("collectImageBlocks", () => {
  it("collects images from results", () => {
    const results = [
      { blocks: [{ type: "text" as const, text: "ok" }, img("plot1")] },
      { blocks: [img("plot2")] },
    ];
    const collected = collectImageBlocks(results, [], 10);
    expect(collected).toEqual([img("plot1"), img("plot2")]);
  });

  it("skips text blocks", () => {
    const results = [
      { blocks: [{ type: "text" as const, text: "just text" }] },
    ];
    const collected = collectImageBlocks(results, [], 10);
    expect(collected).toEqual([]);
  });

  it("preserves existing images", () => {
    const existing = [img("prev")];
    const results = [{ blocks: [img("new")] }];
    const collected = collectImageBlocks(results, existing, 10);
    expect(collected).toEqual([img("prev"), img("new")]);
  });

  it("caps at max count", () => {
    const results = [
      { blocks: [img("a"), img("b"), img("c")] },
    ];
    const collected = collectImageBlocks(results, [], 2);
    expect(collected).toHaveLength(2);
    expect(collected).toEqual([img("a"), img("b")]);
  });

  it("caps considering existing images", () => {
    const existing = [img("x"), img("y")];
    const results = [{ blocks: [img("z")] }];
    const collected = collectImageBlocks(results, existing, 3);
    expect(collected).toHaveLength(3);
    expect(collected[2]).toEqual(img("z"));
  });

  it("handles results without blocks", () => {
    const results = [{ content: "text only" } as { blocks?: ToolResultBlock[] }];
    const collected = collectImageBlocks(results, [], 10);
    expect(collected).toEqual([]);
  });
});

describe("formatMetadata", () => {
  it("formats normal completion", () => {
    const meta: DelegateMetadata = {
      mode: "explore",
      turnsUsed: 4,
      turnsMax: 10,
      toolsUsed: ["web_search", "web_fetch"],
      completionReason: "done",
      urlsFetched: [],
      searchQueries: [],
    };
    expect(formatMetadata(meta)).toBe(
      "[explore: 4/10 turns | tools: web_search, web_fetch]",
    );
  });

  it("formats turn limit", () => {
    const meta: DelegateMetadata = {
      mode: "execute",
      turnsUsed: 15,
      turnsMax: 15,
      toolsUsed: ["file_edit", "file_read", "shell"],
      completionReason: "turn_limit",
      urlsFetched: [],
      searchQueries: [],
    };
    expect(formatMetadata(meta)).toBe(
      "[execute: 15/15 turns | tools: file_edit, file_read, shell | hit turn limit]",
    );
  });

  it("formats circuit break", () => {
    const meta: DelegateMetadata = {
      mode: "explore",
      turnsUsed: 5,
      turnsMax: 10,
      toolsUsed: ["grep"],
      completionReason: "circuit_break",
      urlsFetched: [],
      searchQueries: [],
    };
    expect(formatMetadata(meta)).toBe(
      "[explore: 5/10 turns | tools: grep | stopped: repeated errors]",
    );
  });

  it("formats context overflow", () => {
    const meta: DelegateMetadata = {
      mode: "explore",
      turnsUsed: 8,
      turnsMax: 10,
      toolsUsed: ["file_read", "web_fetch"],
      completionReason: "context_overflow",
      urlsFetched: [],
      searchQueries: [],
    };
    expect(formatMetadata(meta)).toBe(
      "[explore: 8/10 turns | tools: file_read, web_fetch | ran out of context]",
    );
  });

  it("shows 'none' when no tools were used", () => {
    const meta: DelegateMetadata = {
      mode: "explore",
      turnsUsed: 1,
      turnsMax: 10,
      toolsUsed: [],
      completionReason: "done",
      urlsFetched: [],
      searchQueries: [],
    };
    expect(formatMetadata(meta)).toBe("[explore: 1/10 turns | tools: none]");
  });

  it("includes source count when URLs fetched", () => {
    const meta: DelegateMetadata = {
      mode: "explore",
      turnsUsed: 3,
      turnsMax: 10,
      toolsUsed: ["web_fetch"],
      completionReason: "done",
      urlsFetched: ["https://example.com", "https://docs.api.com"],
      searchQueries: [],
    };
    expect(formatMetadata(meta)).toBe(
      "[explore: 3/10 turns | tools: web_fetch | sources: 2 URL(s)]",
    );
  });

  it("includes query count when searches performed", () => {
    const meta: DelegateMetadata = {
      mode: "explore",
      turnsUsed: 5,
      turnsMax: 10,
      toolsUsed: ["web_search", "web_fetch"],
      completionReason: "done",
      urlsFetched: ["https://example.com"],
      searchQueries: ["best practices auth", "OAuth2 vs JWT"],
    };
    expect(formatMetadata(meta)).toBe(
      "[explore: 5/10 turns | tools: web_search, web_fetch | sources: 1 URL(s) | queries: 2]",
    );
  });
});

describe("buildSourcesSection", () => {
  it("returns empty string when no sources", () => {
    expect(buildSourcesSection([], [])).toBe("");
  });

  it("formats URLs only", () => {
    const result = buildSourcesSection(
      ["https://example.com", "https://docs.api.com"],
      [],
    );
    expect(result).toContain("--- Sources (2) ---");
    expect(result).toContain("  https://example.com");
    expect(result).toContain("  https://docs.api.com");
    expect(result).not.toContain("Search queries");
  });

  it("formats queries only", () => {
    const result = buildSourcesSection([], ["best practices auth"]);
    expect(result).toContain('--- Search queries (1) ---');
    expect(result).toContain('  "best practices auth"');
    expect(result).not.toContain("Sources");
  });

  it("formats both URLs and queries", () => {
    const result = buildSourcesSection(
      ["https://example.com"],
      ["auth best practices", "OAuth2 tutorial"],
    );
    expect(result).toContain("--- Sources (1) ---");
    expect(result).toContain("  https://example.com");
    expect(result).toContain("--- Search queries (2) ---");
    expect(result).toContain('  "auth best practices"');
    expect(result).toContain('  "OAuth2 tutorial"');
  });
});

describe("assembleDelegateResult (cross-module)", () => {
  const baseMeta: DelegateMetadata = {
    mode: "explore",
    turnsUsed: 3,
    turnsMax: 10,
    toolsUsed: ["web_search", "web_fetch"],
    completionReason: "done",
    urlsFetched: ["https://example.com"],
    searchQueries: ["test query"],
  };

  it("assembles explore result with metadata, content, and sources", () => {
    const result = assembleDelegateResult("Research findings here.", baseMeta, new Set(), []);
    expect(result.content).toContain("[explore: 3/10 turns");
    expect(result.content).toContain("Research findings here.");
    expect(result.content).toContain("--- Sources (1) ---");
    expect(result.content).toContain("https://example.com");
    expect(result.content).toContain('--- Search queries (1) ---');
    expect(result.content).toContain('"test query"');
    expect(result.blocks).toBeUndefined();
  });

  it("assembles execute result with modified files list", () => {
    const meta: DelegateMetadata = { ...baseMeta, mode: "execute" };
    const modified = new Set(["src/foo.ts", "src/bar.ts"]);
    const result = assembleDelegateResult("Fixed the bug.", meta, modified, []);
    expect(result.content).toContain("[execute: 3/10 turns");
    expect(result.content).toContain("Fixed the bug.");
    expect(result.content).toContain("--- Modified files (2) ---");
    expect(result.content).toContain("  - src/foo.ts");
    expect(result.content).toContain("  - src/bar.ts");
    expect(result.content).toContain("--- Sources (1) ---");
  });

  it("assembles result with images as blocks", () => {
    const images: ToolResultBlock[] = [img("chart1"), img("chart2")];
    const result = assembleDelegateResult("Data analysis.", baseMeta, new Set(), images);
    expect(result.content).toContain("Data analysis.");
    expect(result.blocks).toHaveLength(3); // 1 text + 2 images
    expect(result.blocks![0]).toEqual({ type: "text", text: result.content });
    expect(result.blocks![1]).toEqual(img("chart1"));
  });

  it("handles empty response with no modified files", () => {
    const result = assembleDelegateResult("", baseMeta, new Set(), []);
    expect(result.content).toContain("Sub-agent completed without producing a response.");
    expect(result.content).toContain("--- Sources (1) ---");
  });

  it("shows (no summary) for execute mode with files but no text", () => {
    const meta: DelegateMetadata = { ...baseMeta, mode: "execute" };
    const result = assembleDelegateResult("", meta, new Set(["a.ts"]), []);
    expect(result.content).toContain("(no summary)");
    expect(result.content).toContain("--- Modified files (1) ---");
  });

  it("handles turn_limit with sources and images", () => {
    const meta: DelegateMetadata = { ...baseMeta, completionReason: "turn_limit" };
    const images: ToolResultBlock[] = [img("partial")];
    const result = assembleDelegateResult("Partial results.", meta, new Set(), images);
    expect(result.content).toContain("hit turn limit");
    expect(result.content).toContain("Partial results.");
    expect(result.content).toContain("--- Sources (1) ---");
    expect(result.blocks).toHaveLength(2);
  });
});

// --- Prompt template integration tests ---

describe("runDelegate prompt template resolution", () => {
  const testDir = join(tmpdir(), `kota-delegate-prompt-test-${Date.now()}`);
  const promptsDir = join(testDir, ".kota", "prompts");

  beforeAll(() => {
    mkdirSync(promptsDir, { recursive: true });
    writeFileSync(
      join(promptsDir, "code-review.md"),
      [
        "---",
        "name: code-review",
        "description: Custom code review prompt",
        "variables: [language, focus]",
        "---",
        "You are reviewing {{language}} code. Focus on: {{focus}}.",
      ].join("\n"),
    );
    writeFileSync(
      join(promptsDir, "simple.md"),
      ["---", "name: simple", "---", "You are a simple helper."].join("\n"),
    );
    // Configure delegate to use the test directory
    setDelegateConfig({ model: "test-model", cwd: testDir });
  });

  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  it("rejects unknown prompt template", async () => {
    const result = await runDelegate({
      task: "test",
      prompt: "nonexistent",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('prompt template "nonexistent" not found');
    expect(result.content).toContain("code-review");
    expect(result.content).toContain("simple");
  });

  it("lists available templates when prompt not found", async () => {
    const result = await runDelegate({ task: "test", prompt: "missing" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Available:");
    expect(result.content).toContain("code-review");
  });

  it("resolves prompt template with variables", async () => {
    // This will fail at API call (no real client), but will pass validation+resolution
    const result = await runDelegate({
      task: "review auth module",
      prompt: "code-review",
      prompt_vars: { language: "TypeScript", focus: "security" },
    });
    // Fails at API level, not at prompt resolution
    if (result.is_error) {
      expect(result.content).not.toContain("prompt template");
      expect(result.content).not.toContain("not found");
    }
  });

  it("resolves simple prompt without variables", async () => {
    const result = await runDelegate({
      task: "help me",
      prompt: "simple",
    });
    if (result.is_error) {
      expect(result.content).not.toContain("prompt template");
      expect(result.content).not.toContain("not found");
    }
  });

  it("works normally without prompt parameter", async () => {
    const result = await runDelegate({
      task: "find bugs",
      mode: "explore",
    });
    if (result.is_error) {
      expect(result.content).not.toContain("prompt template");
    }
  });

  it("warns about missing variables in template", async () => {
    // Use code-review template without providing required vars
    const result = await runDelegate({
      task: "review code",
      prompt: "code-review",
      prompt_vars: { language: "Python" },
      // missing "focus" variable
    });
    // Validation passes — error is from API, not from template resolution
    if (result.is_error) {
      expect(result.content).not.toContain("prompt template");
    }
  });
});

describe("runDelegate prompt with empty prompts dir", () => {
  const emptyDir = join(tmpdir(), `kota-empty-prompt-test-${Date.now()}`);

  beforeAll(() => {
    setDelegateConfig({ model: "test-model", cwd: emptyDir });
  });

  afterAll(() => {
    if (existsSync(emptyDir)) rmSync(emptyDir, { recursive: true });
  });

  it("shows 'no templates found' when prompts dir missing", async () => {
    const result = await runDelegate({ task: "test", prompt: "anything" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("No templates found");
  });
});
