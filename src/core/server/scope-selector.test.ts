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

  it("normalizes scopeId client arguments to the projectId compatibility selector", async () => {
    const list = vi.fn(async (_filter: { scopeId?: string; projectId?: string }) => ({
      approvals: [],
    }));
    const handlers = normalizeScopeSelectorClientHandlers({
      approvals: { list },
    });

    await handlers.approvals.list({ scopeId: "scope-a" });

    expect(list).toHaveBeenCalledWith({
      scopeId: "scope-a",
      projectId: "scope-a",
    });
  });

  it("rejects conflicting client selectors before invoking a namespace handler", async () => {
    const approve = vi.fn(
      async (_selector: { scopeId?: string; projectId?: string }) => ({
        ok: true as const,
      }),
    );
    const handlers = normalizeScopeSelectorClientHandlers({
      approvals: { approve },
    });

    expect(() =>
      handlers.approvals.approve({ scopeId: "scope-a", projectId: "scope-b" }),
    ).toThrow("Conflicting scope selectors");
    expect(approve).not.toHaveBeenCalled();
  });

  it("rewrites matched route query scopeId to projectId and rejects conflicts", () => {
    const normalized = normalizeScopeSelectorQueryUrl(
      new URL("http://localhost/approvals?status=pending&scopeId=scope-a"),
    );
    expect(normalized).toEqual({
      ok: true,
      changed: true,
      pathWithQuery: "/approvals?status=pending&scopeId=scope-a&projectId=scope-a",
    });

    const conflict = normalizeScopeSelectorQueryUrl(
      new URL("http://localhost/approvals?scopeId=scope-a&projectId=scope-b"),
    );
    expect(conflict).toEqual({
      ok: false,
      status: 400,
      body: {
        error: "Conflicting scope selectors",
        reason: "conflicting_scope_selectors",
        scopeId: "scope-a",
        projectId: "scope-b",
      },
    });
  });
});
