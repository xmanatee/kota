import { describe, it, expect } from "vitest";
import { normalizeWhitespace, tryWhitespaceMatch } from "./file-edit.js";

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
