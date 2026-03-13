import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractFileReferences, readContextLines, enrichWithSourceContext } from "./error-context.js";
import * as fs from "node:fs";

// Mock fs to control which files "exist" and their content
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

const mockExists = fs.existsSync as ReturnType<typeof vi.fn>;
const mockRead = fs.readFileSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExists.mockReset();
  mockRead.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractFileReferences", () => {
  it("extracts TypeScript paren format", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      "src/foo.ts(42,10): error TS2345: Argument not assignable",
    );
    expect(refs).toEqual([{ path: "src/foo.ts", line: 42 }]);
  });

  it("extracts TypeScript colon format", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      "src/bar.ts:15:3 - error TS2304: Cannot find name 'foo'",
    );
    expect(refs).toEqual([{ path: "src/bar.ts", line: 15 }]);
  });

  it("extracts ESLint format", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      "src/utils.ts:23:5: error  no-unused-vars  'x' is declared but never read",
    );
    expect(refs).toEqual([{ path: "src/utils.ts", line: 23 }]);
  });

  it("extracts Node.js stack trace with parens", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      "    at Object.<anonymous> (src/main.ts:99:12)",
    );
    expect(refs).toEqual([{ path: "src/main.ts", line: 99 }]);
  });

  it("extracts Node.js stack trace without parens", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      "    at src/index.ts:5:1",
    );
    expect(refs).toEqual([{ path: "src/index.ts", line: 5 }]);
  });

  it("extracts Python format", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      '  File "src/app.py", line 42, in main',
    );
    expect(refs).toEqual([{ path: "src/app.py", line: 42 }]);
  });

  it("deduplicates same file:line", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      "src/a.ts(10,1): error TS1\n" +
      "    at fn (src/a.ts:10:1)",
    );
    expect(refs).toHaveLength(1);
  });

  it("skips node_modules paths", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      "    at Object (node_modules/lib/index.js:42:10)",
    );
    expect(refs).toHaveLength(0);
  });

  it("skips dist paths", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      "    at run (dist/cli.js:10:5)",
    );
    expect(refs).toHaveLength(0);
  });

  it("skips non-existent files", () => {
    mockExists.mockReturnValue(false);
    const refs = extractFileReferences(
      "src/nonexistent.ts(1,1): error TS0000: nope",
    );
    expect(refs).toHaveLength(0);
  });

  it("limits to 5 references", () => {
    mockExists.mockReturnValue(true);
    const lines = Array.from({ length: 10 }, (_, i) =>
      `src/file${i}.ts(${i + 1},1): error TS0000: err`,
    ).join("\n");
    const refs = extractFileReferences(lines);
    expect(refs).toHaveLength(5);
  });

  it("extracts multiple different files", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      "src/a.ts(10,1): error TS1\n" +
      "src/b.ts(20,1): error TS2\n" +
      "src/c.ts(30,1): error TS3",
    );
    expect(refs).toHaveLength(3);
    expect(refs[0]).toEqual({ path: "src/a.ts", line: 10 });
    expect(refs[1]).toEqual({ path: "src/b.ts", line: 20 });
    expect(refs[2]).toEqual({ path: "src/c.ts", line: 30 });
  });

  it("skips URLs that look like file:line", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      "    at fetch (https://example.com:443:1)",
    );
    expect(refs).toHaveLength(0);
  });

  it("handles scoped package paths", () => {
    mockExists.mockReturnValue(true);
    const refs = extractFileReferences(
      "    at fn (@scope/pkg/src/index.ts:5:1)",
    );
    expect(refs).toEqual([{ path: "@scope/pkg/src/index.ts", line: 5 }]);
  });
});

describe("readContextLines", () => {
  it("reads lines around target with marker", () => {
    mockRead.mockReturnValue("line1\nline2\nline3\nline4\nline5\nline6\nline7\n");
    const result = readContextLines("test.ts", 4, 2);
    expect(result).not.toBeNull();
    expect(result).toContain(">4: line4");
    expect(result).toContain(" 2: line2");
    expect(result).toContain(" 6: line6");
    expect(result).not.toContain("line1");
    expect(result).not.toContain("line7");
  });

  it("handles target at start of file", () => {
    mockRead.mockReturnValue("first\nsecond\nthird\n");
    const result = readContextLines("test.ts", 1, 2);
    expect(result).not.toBeNull();
    expect(result).toContain(">1: first");
    expect(result).toContain(" 2: second");
    expect(result).toContain(" 3: third");
  });

  it("handles target at end of file", () => {
    mockRead.mockReturnValue("a\nb\nc\n");
    const result = readContextLines("test.ts", 3, 2);
    expect(result).not.toBeNull();
    expect(result).toContain(">3: c");
    expect(result).toContain(" 1: a");
  });

  it("returns null for read errors", () => {
    mockRead.mockImplementation(() => { throw new Error("ENOENT"); });
    const result = readContextLines("missing.ts", 1);
    expect(result).toBeNull();
  });
});

describe("enrichWithSourceContext", () => {
  it("appends source context for referenced files", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue("const x = 1;\nconst y = 2;\nconst z = 3;\n");
    const input = "src/foo.ts(2,1): error TS0000: something wrong";
    const result = enrichWithSourceContext(input);
    expect(result).toContain("--- Referenced source ---");
    expect(result).toContain("src/foo.ts:2:");
    expect(result).toContain(">2: const y = 2;");
  });

  it("returns input unchanged when no references found", () => {
    mockExists.mockReturnValue(false);
    const input = "Some error with no file references";
    expect(enrichWithSourceContext(input)).toBe(input);
  });

  it("deduplicates nearby references to same file", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue(
      Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n"),
    );
    const input =
      "src/foo.ts(10,1): error TS1\n" +
      "src/foo.ts(12,1): error TS2";
    const result = enrichWithSourceContext(input);
    expect(result).toContain("--- Referenced source ---");
    // Lines 10 and 12 are within threshold (10), so only one context block
    const contextBlocks = result.split("--- Referenced source ---")[1];
    const fileHeaders = contextBlocks.match(/src\/foo\.ts:\d+:/g);
    expect(fileHeaders).toHaveLength(1);
  });

  it("includes multiple files when references are in different files", () => {
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue("a\nb\nc\n");
    const input =
      "src/a.ts(1,1): error TS1\n" +
      "src/b.ts(1,1): error TS2";
    const result = enrichWithSourceContext(input);
    expect(result).toContain("src/a.ts:1:");
    expect(result).toContain("src/b.ts:1:");
  });
});
