import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFreshness, recordRead } from "../file-tracker.js";
import { buildNotFoundMessage, normalizeWhitespace, tryWhitespaceMatch } from "./file-edit-helpers.js";
import { runFileEdit } from "./file-edit.js";

describe("normalizeWhitespace", () => {
  it("trims each line and collapses blank lines", () => {
    const input = "  hello  \n  world  \n\n\n  end  ";
    expect(normalizeWhitespace(input)).toBe("hello\nworld\nend");
  });

  it("handles tabs and mixed whitespace", () => {
    expect(normalizeWhitespace("\tconst x = 1;\n\t\treturn x;")).toBe(
      "const x = 1;\nreturn x;",
    );
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeWhitespace("   \n\n   ")).toBe("");
  });

  it("preserves single non-blank line", () => {
    expect(normalizeWhitespace("  hello world  ")).toBe("hello world");
  });
});

describe("tryWhitespaceMatch", () => {
  const fileContent = [
    "function greet() {",
    "    const name = 'world';",
    "    console.log(`hello ${name}`);",
    "    return name;",
    "}",
  ].join("\n");

  it("matches with wrong indentation (tabs vs spaces)", () => {
    const oldStr = [
      "\tconst name = 'world';",
      "\tconsole.log(`hello ${name}`);",
      "\treturn name;",
    ].join("\n");

    const result = tryWhitespaceMatch(fileContent, oldStr);
    expect(result).not.toBeNull();
    expect(result).toContain("const name = 'world'");
    expect(result).toContain("    "); // Original indentation preserved
  });

  it("matches with different indent levels", () => {
    const oldStr = [
      "  const name = 'world';",
      "  console.log(`hello ${name}`);",
      "  return name;",
    ].join("\n");

    const result = tryWhitespaceMatch(fileContent, oldStr);
    expect(result).not.toBeNull();
    expect(result).toContain("    const name"); // File's actual 4-space indent
  });

  it("matches with trailing whitespace differences", () => {
    const oldStr = "    const name = 'world';   \n    console.log(`hello ${name}`);   \n    return name;   ";

    const result = tryWhitespaceMatch(fileContent, oldStr);
    expect(result).not.toBeNull();
  });

  it("returns null for non-matching content", () => {
    const oldStr = "const totally = 'different content here';";
    expect(tryWhitespaceMatch(fileContent, oldStr)).toBeNull();
  });

  it("returns null for ambiguous matches (multiple regions match)", () => {
    const content = [
      "if (a) {",
      "    return true;",
      "}",
      "if (b) {",
      "    return true;",
      "}",
    ].join("\n");

    // "return true;" with wrong indentation — matches two places
    const oldStr = "  return true;";
    expect(tryWhitespaceMatch(content, oldStr)).toBeNull();
  });

  it("returns null for too-short search strings", () => {
    // "x = 1" has only 4 non-whitespace chars (below 10 threshold)
    expect(tryWhitespaceMatch(fileContent, "    x = 1")).toBeNull();
  });

  it("handles single-line whitespace mismatch", () => {
    const content = "    const result = computeValue(input);";
    const oldStr = "  const result = computeValue(input);";

    const result = tryWhitespaceMatch(content, oldStr);
    expect(result).toBe("    const result = computeValue(input);");
  });

  it("handles multi-line with extra blank lines in search", () => {
    const content = "function foo() {\n  return 1;\n}";
    // Extra blank line — after normalization, collapsed
    const oldStr = "function foo() {\n\n  return 1;\n\n}";

    const result = tryWhitespaceMatch(content, oldStr);
    expect(result).not.toBeNull();
  });

  it("returns null when file is shorter than search", () => {
    const content = "const x = 1;";
    const oldStr = "const x = 1;\nconst y = 2;\nconst z = 3;";
    expect(tryWhitespaceMatch(content, oldStr)).toBeNull();
  });

  it("returns exact file region for replacement", () => {
    const content = [
      "class Foo {",
      "    private value: number;",
      "",
      "    constructor() {",
      "        this.value = 42;",
      "    }",
      "}",
    ].join("\n");

    // Agent used 2-space indent
    const oldStr = [
      "  constructor() {",
      "    this.value = 42;",
      "  }",
    ].join("\n");

    const result = tryWhitespaceMatch(content, oldStr);
    expect(result).toBe(
      "    constructor() {\n        this.value = 42;\n    }",
    );
  });
});

describe("runFileEdit cross-module (file-edit × lint × file-tracker)", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `file-edit-xmod-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("successful JSON edit passes lint and records modification", async () => {
    const p = join(dir, "data.json");
    writeFileSync(p, '{"name": "alice"}');
    recordRead(p);

    const result = await runFileEdit({
      path: p,
      old_string: '"alice"',
      new_string: '"bob"',
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(p, "utf-8")).toBe('{"name": "bob"}');
    expect(checkFreshness(p)).toBeNull();
  });

  it("reverts JSON edit that introduces syntax error", async () => {
    const p = join(dir, "data.json");
    const original = '{"items": ["one"]}';
    writeFileSync(p, original);

    const result = await runFileEdit({
      path: p,
      old_string: '["one"]',
      new_string: '["one",]',
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("reverted");
    expect(result.content).toContain("syntax error");
    expect(readFileSync(p, "utf-8")).toBe(original);
  });

  it("no false stale warning after lint-reverted edit", async () => {
    const p = join(dir, "stale.json");
    const original = '{"key": "value"}';
    writeFileSync(p, original);
    recordRead(p);

    // First edit: lint fails, gets reverted
    const bad = await runFileEdit({
      path: p,
      old_string: '"value"',
      new_string: '"value",',
    });
    expect(bad.is_error).toBe(true);
    expect(bad.content).toContain("reverted");

    // File tracker should be up-to-date after revert — no false stale warning
    expect(checkFreshness(p)).toBeNull();

    // Retry with valid edit — should succeed without stale warning
    const good = await runFileEdit({
      path: p,
      old_string: '"value"',
      new_string: '"new_value"',
    });
    expect(good.is_error).toBeUndefined();
    expect(good.content).not.toContain("modified since");
  });

  it("no false stale warning after whitespace-match lint-reverted edit", async () => {
    const p = join(dir, "ws-stale.json");
    const original = '{\n    "setting": "old_value_here"\n}';
    writeFileSync(p, original);
    recordRead(p);

    // Whitespace-tolerant match that fails lint
    const bad = await runFileEdit({
      path: p,
      old_string: '\t"setting": "old_value_here"',
      new_string: '    "setting": "bad",',
    });
    expect(bad.is_error).toBe(true);
    expect(bad.content).toContain("reverted");

    // File tracker should be up-to-date after revert
    expect(checkFreshness(p)).toBeNull();
  });

  it("whitespace-tolerant match applies valid edit through lint gate", async () => {
    const p = join(dir, "config.json");
    writeFileSync(p, '{\n    "setting": "old_value_here"\n}');

    const result = await runFileEdit({
      path: p,
      old_string: '\t"setting": "old_value_here"',
      new_string: '    "setting": "new_value_here"',
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("whitespace correction");
    expect(readFileSync(p, "utf-8")).toBe('{\n    "setting": "new_value_here"\n}');
  });

  it("reverts whitespace-matched edit when lint fails", async () => {
    const p = join(dir, "config.json");
    const original = '{\n    "setting": "old_value_here"\n}';
    writeFileSync(p, original);

    const result = await runFileEdit({
      path: p,
      old_string: '\t"setting": "old_value_here"',
      new_string: '    "setting": "bad_value",',
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("reverted");
    expect(readFileSync(p, "utf-8")).toBe(original);
  });

  it("shows fuzzy match with line numbers when old_string not found", async () => {
    const p = join(dir, "app.txt");
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1} content here`);
    lines[9] = "  const result = computeSpecialValue(input);";
    writeFileSync(p, lines.join("\n"));

    const result = await runFileEdit({
      path: p,
      old_string: "const result = computeSpecialValue(output);",
      new_string: "const result = newValue;",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("similar");
    expect(result.content).toMatch(/line \d+/i);
  });

  it("includes stale warning when file changed externally", async () => {
    const p = join(dir, "data.txt");
    writeFileSync(p, "original content here and more text for matching");
    recordRead(p);
    const future = new Date(Date.now() + 10000);
    utimesSync(p, future, future);

    const result = await runFileEdit({
      path: p,
      old_string: "nonexistent string that will not match anything at all here",
      new_string: "replacement",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("modified since");
  });
});

describe("$ substitution in replacement strings", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `file-edit-dollar-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves literal $& in new_string", async () => {
    const p = join(dir, "script.txt");
    writeFileSync(p, "echo hello world");

    const result = await runFileEdit({
      path: p,
      old_string: "hello world",
      new_string: "$& is the match",
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(p, "utf-8")).toBe("echo $& is the match");
  });

  it("preserves literal $$ in new_string", async () => {
    const p = join(dir, "price.txt");
    writeFileSync(p, "the cost is PLACEHOLDER");

    const result = await runFileEdit({
      path: p,
      old_string: "PLACEHOLDER",
      new_string: "$$100",
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(p, "utf-8")).toBe("the cost is $$100");
  });

  it("preserves literal $' in new_string", async () => {
    const p = join(dir, "shell.txt");
    writeFileSync(p, "old_value=something");

    const result = await runFileEdit({
      path: p,
      old_string: "old_value=something",
      new_string: "value=$'escaped'",
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(p, "utf-8")).toBe("value=$'escaped'");
  });

  it("preserves literal $` in new_string", async () => {
    const p = join(dir, "backtick.txt");
    writeFileSync(p, "replace this text");

    const result = await runFileEdit({
      path: p,
      old_string: "this text",
      new_string: "$`backtick ref",
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(p, "utf-8")).toBe("replace $`backtick ref");
  });

  it("preserves $ in template literals with replace_all", async () => {
    const p = join(dir, "template.txt");
    writeFileSync(p, "log(name)\nlog(name)");

    const result = await runFileEdit({
      path: p,
      old_string: "log(name)",
      new_string: "log(`${name}`)",
      replace_all: true,
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(p, "utf-8")).toBe("log(`${name}`)\nlog(`${name}`)");
  });

  it("preserves $& in whitespace-tolerant match path", async () => {
    const p = join(dir, "ws-dollar.txt");
    writeFileSync(p, "    const regex = /pattern/;");

    const result = await runFileEdit({
      path: p,
      old_string: "\tconst regex = /pattern/;",
      new_string: "    const regex = /new$&pattern/;",
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("whitespace correction");
    expect(readFileSync(p, "utf-8")).toBe("    const regex = /new$&pattern/;");
  });
});

describe("buildNotFoundMessage", () => {
  it("does not override high similarity match with substring match", () => {
    // Line 1 has 95%+ similarity to search; line 10 merely contains the trimmed search
    const lines: string[] = [];
    lines.push("  const result = computeSpecialValue(input);"); // line 1: near-match
    for (let i = 2; i <= 9; i++) lines.push(`filler line ${i}`);
    lines.push("  // old: const result = computeSpecialValue(output); was here"); // line 10: contains trimmed
    const content = lines.join("\n");

    const msg = buildNotFoundMessage(
      "test.ts",
      content,
      "const result = computeSpecialValue(output);",
    );

    // Should point to line 1 (high similarity), not line 10 (substring)
    expect(msg).toContain("line 1");
  });

  it("still uses substring match when similarity is low", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 9; i++) lines.push(`completely different line ${i}`);
    lines.push("  const targetFunction = doSomething();"); // line 10
    const content = lines.join("\n");

    const msg = buildNotFoundMessage(
      "test.ts",
      content,
      "const targetFunction = doSomethingElse();",
    );

    // Should find a match (similarity or substring) rather than "no close match"
    expect(msg).toContain("similar");
  });

  it("shows file preview for completely unrelated content", () => {
    const content = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join("\n");

    const msg = buildNotFoundMessage(
      "test.ts",
      content,
      "totally unrelated search string here",
    );

    expect(msg).toContain("no close match");
    expect(msg).toContain("line 1");
  });
});

describe("runFileEdit edge cases", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `file-edit-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns error for empty path", async () => {
    const result = await runFileEdit({
      path: "",
      old_string: "a",
      new_string: "b",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("path is required");
  });

  it("returns error for empty old_string", async () => {
    const p = join(dir, "file.txt");
    writeFileSync(p, "content");

    const result = await runFileEdit({
      path: p,
      old_string: "",
      new_string: "b",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("old_string is required");
  });

  it("returns error when old_string equals new_string", async () => {
    const p = join(dir, "file.txt");
    writeFileSync(p, "same");

    const result = await runFileEdit({
      path: p,
      old_string: "same",
      new_string: "same",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("identical");
  });

  it("allows empty new_string for deletion", async () => {
    const p = join(dir, "delete.txt");
    writeFileSync(p, "keep this remove_me and this");

    const result = await runFileEdit({
      path: p,
      old_string: "remove_me ",
      new_string: "",
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(p, "utf-8")).toBe("keep this and this");
  });

  it("returns error for nonexistent file", async () => {
    const result = await runFileEdit({
      path: join(dir, "nope.txt"),
      old_string: "a",
      new_string: "b",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("not found");
  });

  it("replace_all replaces all occurrences", async () => {
    const p = join(dir, "multi.txt");
    writeFileSync(p, "foo bar foo baz foo");

    const result = await runFileEdit({
      path: p,
      old_string: "foo",
      new_string: "qux",
      replace_all: true,
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(p, "utf-8")).toBe("qux bar qux baz qux");
    expect(result.content).toContain("3 occurrence");
  });

  it("rejects ambiguous match without replace_all", async () => {
    const p = join(dir, "ambig.txt");
    writeFileSync(p, "foo bar foo");

    const result = await runFileEdit({
      path: p,
      old_string: "foo",
      new_string: "baz",
    });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("2 times");
    expect(result.content).toContain("replace_all");
  });

  it("handles match at end of file", async () => {
    const p = join(dir, "endmatch.txt");
    writeFileSync(p, "start middle end_marker");

    const result = await runFileEdit({
      path: p,
      old_string: "end_marker",
      new_string: "new_end",
    });

    expect(result.is_error).toBeUndefined();
    expect(readFileSync(p, "utf-8")).toBe("start middle new_end");
  });
});
