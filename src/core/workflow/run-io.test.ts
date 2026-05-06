import { describe, expect, it } from "vitest";
import { safeJsonStringify } from "./run-io.js";

describe("safeJsonStringify", () => {
  it("serializes plain values", () => {
    expect(safeJsonStringify({ a: 1 })).toBe('{"a":1}');
    expect(safeJsonStringify([1, 2])).toBe("[1,2]");
    expect(safeJsonStringify("hello")).toBe('"hello"');
  });

  it("respects indent parameter", () => {
    expect(safeJsonStringify({ a: 1 }, 2)).toBe('{\n  "a": 1\n}');
  });

  it("converts BigInt to string", () => {
    expect(safeJsonStringify({ n: 9007199254740993n })).toBe(
      '{"n":"9007199254740993"}',
    );
  });

  it("converts functions to descriptive string", () => {
    function myFunc() {}
    const result = safeJsonStringify({ fn: myFunc });
    expect(result).toContain("[Function myFunc]");
  });

  it("converts anonymous function to descriptive string", () => {
    const result = safeJsonStringify({ fn: () => {} });
    expect(result).toContain("[Function");
  });

  it("converts Error to object with name, message, stack", () => {
    const err = new Error("oops");
    const parsed = JSON.parse(safeJsonStringify({ err }));
    expect(parsed.err.name).toBe("Error");
    expect(parsed.err.message).toBe("oops");
    expect(typeof parsed.err.stack).toBe("string");
  });

  it("converts Map to plain object", () => {
    const map = new Map([["a", 1]]);
    expect(safeJsonStringify({ m: map })).toBe('{"m":{"a":1}}');
  });

  it("converts Set to array", () => {
    const set = new Set([1, 2, 3]);
    const parsed = JSON.parse(safeJsonStringify({ s: set }));
    expect(parsed.s).toEqual([1, 2, 3]);
  });

  it("handles circular references", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const result = safeJsonStringify(obj);
    expect(result).toContain("[Circular]");
  });
});
