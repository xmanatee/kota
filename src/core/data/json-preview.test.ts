import { describe, expect, it } from "vitest";
import { formatJsonPreview, JSON_EXTENSIONS } from "./json-preview.js";

describe("JSON_EXTENSIONS", () => {
  it("includes .json, .jsonl, .ndjson", () => {
    expect(JSON_EXTENSIONS.has(".json")).toBe(true);
    expect(JSON_EXTENSIONS.has(".jsonl")).toBe(true);
    expect(JSON_EXTENSIONS.has(".ndjson")).toBe(true);
    expect(JSON_EXTENSIONS.has(".csv")).toBe(false);
  });
});

describe("formatJsonPreview", () => {
  it("returns empty string for invalid JSON", () => {
    expect(formatJsonPreview("not json {", "data.json")).toBe("");
  });

  it("previews scalar JSON value", () => {
    const result = formatJsonPreview('"hello"', "val.json");
    expect(result).toContain("scalar");
    expect(result).toContain('"hello"');
  });

  it("previews top-level object with keys and types", () => {
    const json = JSON.stringify({ name: "Alice", age: 30, active: true, tags: ["a", "b"] });
    const result = formatJsonPreview(json, "user.json");
    expect(result).toContain("Object with 4 keys");
    expect(result).toContain("name:");
    expect(result).toContain("age:");
    expect(result).toContain("tags:");
  });

  it("previews top-level array of uniform objects with schema", () => {
    const data = Array.from({ length: 25 }, (_, i) => ({
      id: i,
      name: `user${i}`,
      email: `u${i}@test.com`,
    }));
    const result = formatJsonPreview(JSON.stringify(data), "users.json");
    expect(result).toContain("Array with 25 elements");
    expect(result).toContain("Element schema");
    expect(result).toContain("id: number");
    expect(result).toContain("name: string");
    expect(result).toContain("email: string");
  });

  it("previews mixed-type array with samples", () => {
    const data = [1, "hello", null, true];
    const result = formatJsonPreview(JSON.stringify(data), "mixed.json");
    expect(result).toContain("Array with 4 elements");
    expect(result).toContain("Sample elements");
  });

  it("handles empty array", () => {
    const result = formatJsonPreview("[]", "empty.json");
    expect(result).toContain("Array with 0 elements");
  });

  it("handles empty object", () => {
    const result = formatJsonPreview("{}", "empty.json");
    expect(result).toContain("Object with 0 keys");
  });

  it("truncates objects with many keys", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 20; i++) obj[`key${i}`] = i;
    const result = formatJsonPreview(JSON.stringify(obj), "big.json");
    expect(result).toContain("+5 more keys");
  });

  it("previews JSONL format", () => {
    const jsonl = '{"id":1,"val":"a"}\n{"id":2,"val":"b"}\n{"id":3,"val":"c"}\n';
    const result = formatJsonPreview(jsonl, "data.jsonl");
    expect(result).toContain("JSONL: 3 lines");
    expect(result).toContain("id: number");
    expect(result).toContain("val: string");
  });

  it("previews NDJSON format", () => {
    const ndjson = '{"x":1}\n{"x":2}\n';
    const result = formatJsonPreview(ndjson, "data.ndjson");
    expect(result).toContain("JSONL: 2 lines");
  });

  it("ends with double newline for prepending to content", () => {
    const result = formatJsonPreview('{"a":1}', "test.json");
    expect(result).toMatch(/\n\n$/);
  });
});
