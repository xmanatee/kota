import { describe, expect, it } from "vitest";
import { parseRetractRequestBody } from "./routes.js";

describe("parseRetractRequestBody", () => {
  it("decodes the generated uniform request", () => {
    expect(
      parseRetractRequestBody({
        target: "knowledge",
        identifier: "entry-slug",
        scopeId: "scope-a",
      }),
    ).toEqual({
      ok: true,
      request: {
        target: "knowledge",
        identifier: "entry-slug",
        scopeId: "scope-a",
      },
    });
  });

  it.each([
    [{ identifier: "id" }, "target is invalid"],
    [{ target: "unknown", identifier: "id" }, "target is invalid"],
    [{ target: "memory", identifier: "" }, "identifier is required"],
    [{ target: "memory", identifier: "id", slug: "extra" }, 'unknown field "slug"'],
  ])("rejects malformed destructive input", (body, error) => {
    expect(parseRetractRequestBody(body)).toEqual({ ok: false, error });
  });
});
