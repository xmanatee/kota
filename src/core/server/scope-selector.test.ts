import { describe, expect, it, vi } from "vitest";
import {
  encodeQueryParams,
  normalizeScopeSelectorClientHandlers,
  normalizeScopeSelectorQueryUrl,
} from "./scope-selector.js";

describe("scope selector helpers", () => {
  it("serializes query params with encodeURIComponent semantics", () => {
    const params = new URLSearchParams();
    params.set("status", "weird+status %value");
    expect(encodeQueryParams(params)).toBe("status=weird%2Bstatus%20%25value");
  });

  it("normalizes a scope selector before invoking a namespace handler", async () => {
    const list = vi.fn(async (_filter: { scopeId?: string }) => ({ approvals: [] }));
    const handlers = normalizeScopeSelectorClientHandlers({ approvals: { list } });

    await handlers.approvals.list({ scopeId: " scope-a " });

    expect(list).toHaveBeenCalledWith({ scopeId: "scope-a" });
  });

  it("preserves other query parameters while normalizing scopeId", () => {
    expect(
      normalizeScopeSelectorQueryUrl(
        new URL("http://localhost/approvals?status=pending&scopeId=scope-a"),
      ),
    ).toEqual({
      ok: true,
      changed: true,
      pathWithQuery: "/approvals?status=pending&scopeId=scope-a",
    });
  });
});
