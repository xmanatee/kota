import { describe, it, expect } from "vitest";
import { extractModifiedFiles, buildDelegateResult, collectImageBlocks } from "./delegate.js";
import type { ToolResultBlock } from "./index.js";

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
