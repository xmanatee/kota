import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandUserPromptReferences, MAX_REF_BYTES } from "./expand.js";

const TEST_ROOT = join(process.cwd(), ".test-prompt-input");

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("expandUserPromptReferences", () => {
  it("leaves prompts without references unchanged", () => {
    const result = expandUserPromptReferences("explain this repo", TEST_ROOT);
    expect(result.text).toBe("explain this repo");
    expect(result.references).toEqual([]);
  });

  it("inlines a referenced file below the prompt", () => {
    writeFileSync(join(TEST_ROOT, "notes.md"), "hello world", "utf-8");
    const result = expandUserPromptReferences("read @notes.md please", TEST_ROOT);

    expect(result.text).toContain("read @notes.md please");
    expect(result.text).toContain('<file path="notes.md">');
    expect(result.text).toContain("hello world");
    expect(result.text).toContain("</file>");
    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({ kind: "file", display: "notes.md" });
  });

  it("preserves prose tokens that look like decorators", () => {
    const result = expandUserPromptReferences("see @see for examples", TEST_ROOT);
    // `@see` is not a path and shouldn't be expanded. The tokenizer still
    // reports it as a missing reference; no file block is attached.
    expect(result.text).toBe("see @see for examples");
    expect(result.references[0]?.kind).toBe("missing");
  });

  it("ignores @ tokens glued to other characters (e.g. email addresses)", () => {
    const result = expandUserPromptReferences(
      "ping me at user@example.com please",
      TEST_ROOT,
    );
    expect(result.text).toBe("ping me at user@example.com please");
    expect(result.references).toEqual([]);
  });

  it("expands multiple references and dedupes repeats", () => {
    writeFileSync(join(TEST_ROOT, "a.txt"), "aa", "utf-8");
    writeFileSync(join(TEST_ROOT, "b.txt"), "bb", "utf-8");
    const result = expandUserPromptReferences(
      "compare @a.txt and @b.txt — also @a.txt again",
      TEST_ROOT,
    );
    expect(result.text).toContain('<file path="a.txt">');
    expect(result.text).toContain("aa");
    expect(result.text).toContain('<file path="b.txt">');
    expect(result.text).toContain("bb");
    // deduped: only one a.txt block
    expect((result.text.match(/<file path="a.txt">/g) ?? []).length).toBe(1);
  });

  it("expands files of any extension, not just markdown", () => {
    writeFileSync(join(TEST_ROOT, "foo.ts"), "export const x = 1;", "utf-8");
    const result = expandUserPromptReferences("review @foo.ts", TEST_ROOT);
    expect(result.text).toContain('<file path="foo.ts">');
    expect(result.text).toContain("export const x = 1;");
  });

  it("leaves trailing punctuation outside the resolved path", () => {
    writeFileSync(join(TEST_ROOT, "readme.md"), "body", "utf-8");
    const result = expandUserPromptReferences(
      "check @readme.md, then stop.",
      TEST_ROOT,
    );
    expect(result.text).toContain('<file path="readme.md">');
    expect(result.references[0]).toMatchObject({ kind: "file" });
  });

  it("reports a missing reference without adding a file block", () => {
    const result = expandUserPromptReferences("read @nope.md", TEST_ROOT);
    expect(result.text).toBe("read @nope.md");
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.kind).toBe("missing");
  });

  it("classifies directories instead of inlining their contents", () => {
    mkdirSync(join(TEST_ROOT, "src"), { recursive: true });
    const result = expandUserPromptReferences("explore @src", TEST_ROOT);
    expect(result.text).toBe("explore @src");
    expect(result.references[0]?.kind).toBe("directory");
  });

  it("truncates a file exceeding the per-reference cap", () => {
    writeFileSync(join(TEST_ROOT, "big.txt"), "x".repeat(MAX_REF_BYTES + 500), "utf-8");
    const result = expandUserPromptReferences("read @big.txt", TEST_ROOT);
    expect(result.text).toContain("... (truncated)");
    const ref = result.references[0];
    expect(ref?.kind).toBe("file");
    if (ref?.kind === "file") {
      expect(ref.truncated).toBe(true);
      expect(ref.inlined.length).toBe(MAX_REF_BYTES);
    }
  });

  it("resolves nested paths against the base directory", () => {
    mkdirSync(join(TEST_ROOT, "docs"), { recursive: true });
    writeFileSync(join(TEST_ROOT, "docs", "guide.md"), "guide body", "utf-8");
    const result = expandUserPromptReferences("read @docs/guide.md", TEST_ROOT);
    expect(result.text).toContain('<file path="docs/guide.md">');
    expect(result.text).toContain("guide body");
  });

  it("supports absolute paths", () => {
    const abs = join(TEST_ROOT, "abs.txt");
    writeFileSync(abs, "abs body", "utf-8");
    const result = expandUserPromptReferences(`read @${abs}`, TEST_ROOT);
    expect(result.text).toContain("abs body");
    expect(result.references[0]).toMatchObject({ kind: "file", display: abs });
  });

  it("does not recursively expand @refs inside file contents", () => {
    writeFileSync(join(TEST_ROOT, "parent.md"), "contents: @child.md", "utf-8");
    writeFileSync(join(TEST_ROOT, "child.md"), "child body", "utf-8");
    const result = expandUserPromptReferences("read @parent.md", TEST_ROOT);
    expect(result.text).toContain("contents: @child.md");
    expect(result.text).not.toContain("child body");
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.display).toBe("parent.md");
  });
});
