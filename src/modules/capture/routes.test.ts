import { describe, expect, it } from "vitest";
import { parseCaptureRequestBody } from "./routes.js";

describe("parseCaptureRequestBody", () => {
  it("decodes the generated transport body", () => {
    expect(
      parseCaptureRequestBody({
        text: "remember this",
        filter: { target: "memory", hint: "preference", scopeId: "scope-a" },
      }),
    ).toEqual({
      ok: true,
      text: "remember this",
      filter: { target: "memory", hint: "preference", scopeId: "scope-a" },
    });
  });

  it.each([
    [{ text: "" }, "text is required"],
    [{ text: "note", extra: true }, 'unknown field "extra"'],
    [{ text: "note", filter: { target: "unknown" } }, "filter.target is invalid"],
    [{ text: "note", filter: { extra: true } }, 'unknown filter field "extra"'],
  ])("rejects malformed write input", (body, error) => {
    expect(parseCaptureRequestBody(body)).toEqual({ ok: false, error });
  });
});
