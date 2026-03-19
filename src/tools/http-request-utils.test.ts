import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatTabularJson,
  isBinaryContentType,
  looksLikeJson,
  safePositiveInt,
} from "./http-request-utils.js";

describe("safePositiveInt", () => {
  it("returns the parsed value for a valid positive number", () => {
    expect(safePositiveInt(10, 5)).toBe(10);
  });

  it("rounds non-integer values", () => {
    expect(safePositiveInt(3.7, 1)).toBe(4);
    expect(safePositiveInt(3.2, 1)).toBe(3);
  });

  it("returns fallback for null", () => {
    expect(safePositiveInt(null, 7)).toBe(7);
  });

  it("returns fallback for undefined", () => {
    expect(safePositiveInt(undefined, 7)).toBe(7);
  });

  it("returns fallback for zero", () => {
    expect(safePositiveInt(0, 5)).toBe(5);
  });

  it("returns fallback for negative numbers", () => {
    expect(safePositiveInt(-3, 5)).toBe(5);
  });

  it("returns fallback for NaN", () => {
    expect(safePositiveInt(NaN, 5)).toBe(5);
  });

  it("returns fallback for non-numeric strings", () => {
    expect(safePositiveInt("abc", 5)).toBe(5);
  });

  it("parses numeric strings", () => {
    expect(safePositiveInt("42", 1)).toBe(42);
  });

  it("caps at max when provided", () => {
    expect(safePositiveInt(100, 10, 50)).toBe(50);
    expect(safePositiveInt(30, 10, 50)).toBe(30);
  });
});

describe("formatBytes", () => {
  it("formats bytes below 1 KB", () => {
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(1023)).toBe("1023B");
  });

  it("formats KB range", () => {
    expect(formatBytes(1024)).toBe("1.0KB");
    expect(formatBytes(1536)).toBe("1.5KB");
  });

  it("formats MB range", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0MB");
    expect(formatBytes(1024 * 1024 * 2.5)).toBe("2.5MB");
  });
});

describe("looksLikeJson", () => {
  it("returns true for object-like strings", () => {
    expect(looksLikeJson('{"key": "val"}')).toBe(true);
  });

  it("returns true for array-like strings", () => {
    expect(looksLikeJson("[1, 2, 3]")).toBe(true);
  });

  it("returns true when leading whitespace precedes object", () => {
    expect(looksLikeJson("  {")).toBe(true);
    expect(looksLikeJson("\n[")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(looksLikeJson("hello")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(looksLikeJson("")).toBe(false);
  });

  it("returns false for XML-like strings", () => {
    expect(looksLikeJson("<xml/>")).toBe(false);
  });
});

describe("isBinaryContentType", () => {
  it("returns true for image types", () => {
    expect(isBinaryContentType("image/png")).toBe(true);
    expect(isBinaryContentType("image/jpeg")).toBe(true);
  });

  it("returns true for audio and video", () => {
    expect(isBinaryContentType("audio/mpeg")).toBe(true);
    expect(isBinaryContentType("video/mp4")).toBe(true);
  });

  it("returns true for octet-stream", () => {
    expect(isBinaryContentType("application/octet-stream")).toBe(true);
  });

  it("returns true for pdf, zip, gzip, tar", () => {
    expect(isBinaryContentType("application/pdf")).toBe(true);
    expect(isBinaryContentType("application/zip")).toBe(true);
    expect(isBinaryContentType("application/gzip")).toBe(true);
    expect(isBinaryContentType("application/x-tar")).toBe(true);
  });

  it("returns false for text types", () => {
    expect(isBinaryContentType("text/html")).toBe(false);
    expect(isBinaryContentType("text/plain")).toBe(false);
    expect(isBinaryContentType("application/json")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isBinaryContentType("")).toBe(false);
  });
});

describe("formatTabularJson", () => {
  it("renders a simple array of objects as a markdown table", () => {
    const data = [{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }];
    const result = formatTabularJson(data);
    expect(result).toContain("| name  | age |");
    expect(result).toContain("| Alice | 30  |");
    expect(result).toContain("| Bob   | 25  |");
  });

  it("returns null for non-array input", () => {
    expect(formatTabularJson({ key: "val" })).toBeNull();
    expect(formatTabularJson("string")).toBeNull();
    expect(formatTabularJson(42)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(formatTabularJson([])).toBeNull();
  });

  it("returns null when elements are not plain objects", () => {
    expect(formatTabularJson([1, 2, 3])).toBeNull();
    expect(formatTabularJson(["a", "b"])).toBeNull();
    expect(formatTabularJson([null])).toBeNull();
  });

  it("returns null when values are nested objects", () => {
    const data = [{ nested: { a: 1 } }];
    expect(formatTabularJson(data)).toBeNull();
  });

  it("returns null when values are arrays", () => {
    const data = [{ tags: ["a", "b"] }];
    expect(formatTabularJson(data)).toBeNull();
  });

  it("handles null cell values as empty string", () => {
    const data = [{ name: "Alice", score: null }];
    const result = formatTabularJson(data);
    expect(result).toContain("Alice");
    expect(result).not.toBeNull();
  });

  it("escapes pipe characters in cell values", () => {
    const data = [{ cmd: "a | b" }];
    const result = formatTabularJson(data);
    expect(result).toContain("a \\| b");
  });

  it("appends truncation note when rows exceed limit", () => {
    const data = Array.from({ length: 60 }, (_, i) => ({ n: i }));
    const result = formatTabularJson(data);
    expect(result).toContain("showing 50 of 60 rows");
  });

  it("appends truncation note when columns exceed limit", () => {
    const row: Record<string, number> = {};
    for (let i = 0; i < 12; i++) row[`col${i}`] = i;
    const result = formatTabularJson([row]);
    expect(result).toContain("showing 10 of 12 columns");
  });
});
