import { describe, expect, it } from "vitest";
import { fileNotFoundError, nameSimilarity, suggestAlternatives } from "./path-resolver.js";

describe("nameSimilarity", () => {
  it("returns 1 for exact match", () => {
    expect(nameSimilarity("helper.ts", "helper.ts")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(nameSimilarity("Helper.ts", "helper.ts")).toBe(1);
  });

  it("returns 0 for single-char strings", () => {
    expect(nameSimilarity("a", "b")).toBe(0);
  });

  it("returns 0 for completely different strings", () => {
    expect(nameSimilarity("abc.ts", "xyz.py")).toBeLessThan(0.2);
  });

  it("scores similar names high", () => {
    const score = nameSimilarity("helper.ts", "helpers.ts");
    expect(score).toBeGreaterThan(0.8);
  });

  it("scores partially overlapping names medium", () => {
    const score = nameSimilarity("file-read.ts", "file-write.ts");
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(0.9);
  });

  it("handles empty strings", () => {
    expect(nameSimilarity("", "abc")).toBe(0);
    expect(nameSimilarity("abc", "")).toBe(0);
  });

  it("scores swapped words lower than exact", () => {
    const exact = nameSimilarity("file-edit.ts", "file-edit.ts");
    const swapped = nameSimilarity("file-edit.ts", "edit-file.ts");
    expect(exact).toBeGreaterThan(swapped);
  });

  it("scores same extension higher than different extension", () => {
    const sameExt = nameSimilarity("utils.ts", "utils.tsx");
    const diffExt = nameSimilarity("utils.ts", "utils.py");
    expect(sameExt).toBeGreaterThan(diffExt);
  });
});

describe("suggestAlternatives", () => {
  it("finds files that exist in the project by exact name", () => {
    // This file exists in the project — should find it
    const results = suggestAlternatives("nonexistent/dir/cli.ts");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.includes("cli.ts"))).toBe(true);
  });

  it("returns empty array for truly nonexistent filenames", () => {
    const results = suggestAlternatives("zzz_no_such_file_ever_qwerty.xyz");
    expect(results).toEqual([]);
  });

  it("respects max parameter", () => {
    const results = suggestAlternatives("nonexistent/test.ts", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("handles empty basename gracefully", () => {
    const results = suggestAlternatives("");
    expect(results).toEqual([]);
  });
});

describe("fileNotFoundError", () => {
  it("includes base error message", () => {
    const msg = fileNotFoundError("does/not/exist/zzz_never.xyz");
    expect(msg).toContain("Error: file not found: does/not/exist/zzz_never.xyz");
  });

  it("includes suggestions when similar files exist", () => {
    const msg = fileNotFoundError("wrong/path/cli.ts");
    expect(msg).toContain("cli.ts");
    // Should have either "Did you mean" or "Similar files found"
    expect(msg.includes("Did you mean") || msg.includes("Similar files found")).toBe(true);
  });

  it("returns bare error when no suggestions available", () => {
    const msg = fileNotFoundError("zzz_truly_unique_name_42.qwerty");
    expect(msg).toBe("Error: file not found: zzz_truly_unique_name_42.qwerty");
  });
});
