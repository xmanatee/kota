import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFreshness, recordRead } from "../file-tracker.js";
import { normalizeWhitespace, runFileEdit, tryWhitespaceMatch } from "./file-edit.js";

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
