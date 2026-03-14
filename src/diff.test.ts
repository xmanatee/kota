import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findLineNumber, printEditDiff, printWriteSummary } from "./diff.js";

describe("findLineNumber", () => {
  it("returns 1 for substring at start", () => {
    expect(findLineNumber("hello\nworld", "hello")).toBe(1);
  });

  it("returns correct line for substring in middle", () => {
    expect(findLineNumber("aaa\nbbb\nccc\nddd", "ccc")).toBe(3);
  });

  it("returns 1 when substring not found", () => {
    expect(findLineNumber("aaa\nbbb", "zzz")).toBe(1);
  });

  it("handles single-line content", () => {
    expect(findLineNumber("only line", "only")).toBe(1);
  });

  it("finds first occurrence when substring appears multiple times", () => {
    expect(findLineNumber("foo\nbar\nfoo\nbaz", "foo")).toBe(1);
  });

  it("handles substring that spans a partial line", () => {
    expect(findLineNumber("alpha\nbeta\ngamma", "beta")).toBe(2);
  });
});

describe("printEditDiff", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("prints diff with removed and added lines", () => {
    const content = "line1\nline2\nline3\nline4";
    printEditDiff("test.ts", content, "line2", "replaced");

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("-line2");
    expect(output).toContain("+replaced");
    expect(output).toContain("test.ts");
  });

  it("includes context lines around the change", () => {
    const content = "a\nb\nc\nd\ne\nf";
    printEditDiff("f.ts", content, "d", "D");

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    // Context before (CONTEXT_LINES = 2)
    expect(output).toContain(" b");
    expect(output).toContain(" c");
    // The change
    expect(output).toContain("-d");
    expect(output).toContain("+D");
    // Context after
    expect(output).toContain(" e");
  });

  it("shows summary for large diffs exceeding MAX_DIFF_LINES", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line${i}`);
    const content = lines.join("\n");
    const oldStr = lines.slice(5, 30).join("\n"); // 25 lines old
    const newStr = lines.slice(5, 30).map((l) => l + "_new").join("\n"); // 25 lines new

    printEditDiff("big.ts", content, oldStr, newStr);

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("replaced 25 lines with 25 lines");
    // Should NOT have unified diff markers
    expect(output).not.toContain("---");
  });

  it("handles edit at the very beginning of file", () => {
    const content = "first\nsecond\nthird";
    printEditDiff("f.ts", content, "first", "FIRST");

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("-first");
    expect(output).toContain("+FIRST");
    expect(output).toContain("@@ -1,1 +1,1 @@");
  });

  it("handles edit at the end of file", () => {
    const content = "a\nb\nc";
    printEditDiff("f.ts", content, "c", "C");

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("-c");
    expect(output).toContain("+C");
  });

  it("handles multi-line replacement with different line counts", () => {
    const content = "a\nb\nc\nd";
    printEditDiff("f.ts", content, "b\nc", "B\nC\nC2");

    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("@@ -2,2 +2,3 @@");
  });
});

describe("printWriteSummary", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("prints old and new line counts", () => {
    printWriteSummary("out.ts", 10, 25);
    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("out.ts");
    expect(output).toContain("10");
    expect(output).toContain("25");
  });

  it("uses arrow between counts", () => {
    printWriteSummary("f.ts", 5, 3);
    const output = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("5 → 3 lines");
  });
});
