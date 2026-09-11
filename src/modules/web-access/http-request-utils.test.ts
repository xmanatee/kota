import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatTabularJson,
  formatTabularJsonPrefix,
  isBinaryContentType,
  looksLikeJson,
  safePositiveInt,
} from "./http-request-utils.js";

describe("HTTP numeric input", () => {
  it.each([null, undefined, 0, -3, NaN, Infinity, "abc"])("defaults invalid input: %s", (value) => {
    expect(safePositiveInt(value, 7)).toBe(7);
  });
  it.each([
    [3.7, 4],
    [3.2, 3],
    ["42", 42],
    [100, 50],
  ])("parses, rounds and caps: %s", (value, expected) => {
    expect(safePositiveInt(value, 1, 50)).toBe(expected);
  });
});

it.each([
  [0, "0B"],
  [1023, "1023B"],
  [1536, "1.5KB"],
  [2621440, "2.5MB"],
])("formats %i bytes", (bytes, expected) => {
  expect(formatBytes(bytes)).toBe(expected);
});

it.each([
  ["  {", true],
  ["\n[", true],
  ["hello", false],
  ["", false],
  ["<xml/>", false],
])("detects JSON prefix: %s", (text, expected) => {
  expect(looksLikeJson(text)).toBe(expected);
});

it.each([
  ["image/png", true],
  ["audio/mpeg", true],
  ["video/mp4", true],
  ["application/octet-stream", true],
  ["application/pdf", true],
  ["application/zip", true],
  ["application/gzip", true],
  ["application/x-tar", true],
  ["text/plain", false],
  ["application/json", false],
  ["", false],
])("classifies HTTP response content: %s", (contentType, expected) => {
  expect(isBinaryContentType(contentType)).toBe(expected);
});

describe("tabular JSON rendering", () => {
  it.each([
    { value: {} },
    { value: "string" },
    { value: 42 },
    { value: [] },
    { value: [null] },
    { value: [1] },
    { value: [{}] },
    { value: [{ a: 1 }, "mixed"] },
    { value: [{ nested: {} }] },
    { value: [{ nested: [] }] },
  ])("declines non-tabular values: $value", ({ value }) => {
    expect(formatTabularJson(value)).toBeNull();
  });

  it("unions columns and renders missing, null, boolean and escaped cells", () => {
    expect(
      formatTabularJson([
        { a: "x|y\nz", b: null },
        { b: false, c: 42 },
      ]),
    ).toBe("| a      | b     | c  |\n| ------ | ----- | -- |\n| x\\|y z |       |    |\n|        | false | 42 |");
  });

  it.each([50, 51])("bounds row output at the display limit: %i", (count) => {
    const result = formatTabularJson(Array.from({ length: count }, (_, n) => ({ n })))!;
    expect(result).toContain("| 49 |");
    expect(result).not.toContain("| 50 |");
    expect(result.includes("showing")).toBe(count > 50);
  });

  it("bounds columns without losing truncation context", () => {
    const row = Object.fromEntries(Array.from({ length: 12 }, (_, n) => [`col${n}`, n]));
    const result = formatTabularJson([row])!;
    expect(result).toContain("col9");
    expect(result).not.toContain("col10");
    expect(result).toContain("showing 10 of 12 columns");
  });

  it("renders only complete objects from truncated input", () => {
    const result = formatTabularJsonPrefix('[{"name":"Alice"},{"name":"Bob"},{"name":"Charl');
    expect(result).toBe("| name  |\n| ----- |\n| Alice |\n| Bob   |");
    expect(formatTabularJsonPrefix('[{"name":"Alice"')).toBeNull();
  });
});
