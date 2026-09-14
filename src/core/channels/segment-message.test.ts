import { describe, expect, it } from "vitest";
import { segmentMessage } from "./segment-message.js";

describe("segmentMessage", () => {
  it.each(["", "hello", "abc😀"])("preserves an unsplit message: %j", (text) => {
    expect(segmentMessage(text, 5)).toEqual([text]);
  });

  it.each([
    ["line1\nline2\nline3", 12, ["line1\nline2", "line3"]],
    ["abc\ndef", 3, ["abc", "def"]],
    ["abc\n", 3, ["abc"]],
    ["abc\n\ndef", 4, ["abc\n", "def"]],
    ["\nabcdef", 3, ["\nab", "cde", "f"]],
    [" a \tb c ", 4, [" a \t", "b c "]],
    ["ab😀\ncd😀ef", 5, ["ab😀", "cd😀e", "f"]],
  ] as const)("retains newline and whitespace semantics: %j", (text, limit, expected) => {
    expect(segmentMessage(text, limit)).toEqual(expected);
  });

  it("preserves scalar values around every hard boundary within the UTF-16 limit", () => {
    const text = "a😀𐐷界e\u0301👩‍💻 xyz".repeat(5);
    for (let limit = 2; limit <= text.length; limit++) {
      const chunks = segmentMessage(text, limit);
      expect(chunks.join("")).toBe(text);
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(chunk.length).toBeLessThanOrEqual(limit);
        expect(Buffer.from(chunk, "utf8").toString("utf8")).toBe(chunk);
      }
    }
  });

  it.each([0, 1, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects limits that cannot bound arbitrary scalar values: %s",
    (limit) => expect(() => segmentMessage("😀", limit)).toThrow(RangeError),
  );
});
