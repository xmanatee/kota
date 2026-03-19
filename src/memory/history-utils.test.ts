import { describe, expect, it } from "vitest";
import { countMessages, extractText } from "./history-utils.js";

describe("extractText", () => {
  it("returns plain string content as-is", () => {
    expect(extractText("hello world")).toBe("hello world");
  });

  it("returns text from first text block in array", () => {
    expect(
      extractText([
        { type: "text", text: "first text" },
        { type: "text", text: "second text" },
      ]),
    ).toBe("first text");
  });

  it("returns null for content-block array with no text block", () => {
    expect(
      extractText([
        { type: "tool_result", tool_use_id: "x", content: "result" },
      ]),
    ).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(extractText([])).toBeNull();
  });

  it("returns text when text block is mixed with tool_result", () => {
    expect(
      extractText([
        { type: "tool_result", tool_use_id: "x", content: "result" },
        { type: "text", text: "after tool" },
      ]),
    ).toBe("after tool");
  });
});

describe("countMessages", () => {
  it("returns 0 for empty list", () => {
    expect(countMessages([])).toBe(0);
  });

  it("counts assistant messages", () => {
    expect(
      countMessages([{ role: "assistant", content: "I can help" }]),
    ).toBe(1);
  });

  it("counts user string messages", () => {
    expect(countMessages([{ role: "user", content: "hello" }])).toBe(1);
  });

  it("counts user messages with a text block", () => {
    expect(
      countMessages([
        { role: "user", content: [{ type: "text", text: "hello" }] },
      ]),
    ).toBe(1);
  });

  it("does not count user messages with only tool_result blocks", () => {
    expect(
      countMessages([
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "x", content: "result" },
          ],
        },
      ]),
    ).toBe(0);
  });

  it("counts correctly for a mixed list", () => {
    expect(
      countMessages([
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "x", content: "result" },
          ],
        },
        {
          role: "user",
          content: [{ type: "text", text: "follow up" }],
        },
        { role: "assistant", content: "ok" },
      ]),
    ).toBe(4);
  });
});
