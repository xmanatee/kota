import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("api client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("extracts token from URL and stores it", async () => {
    Object.defineProperty(window, "location", {
      value: { search: "?token=test-token-123", pathname: "/", hash: "" },
      writable: true,
    });
    history.replaceState = vi.fn();

    const { getAuthToken } = await import("./client");
    const token = getAuthToken();
    expect(token).toBe("test-token-123");
    expect(localStorage.getItem("kota-auth-token")).toBe("test-token-123");
  });

  it("sends auth header with API requests", async () => {
    localStorage.setItem("kota-auth-token", "my-token");
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "ok" }),
    });

    const { api } = await import("./client");
    await api.getHealth();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer my-token",
        }),
      }),
    );
  });

  it("marks mutating dashboard API requests for the daemon cookie guard", async () => {
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ already: false }),
    });

    const { api } = await import("./client");
    await api.pauseWorkflow("scope-a");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/workflow/pause?scopeId=scope-a",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Kota-Dashboard-Request": "1",
        }),
      }),
    );
  });

  describe("owner questions", () => {
    beforeEach(() => {
      Object.defineProperty(window, "location", {
        value: { search: "", pathname: "/", hash: "" },
        writable: true,
      });
    });

    it("listOwnerQuestions calls GET /api/owner-questions", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ questions: [] }),
      });

      const { api } = await import("./client");
      const result = await api.listOwnerQuestions();

      expect(result).toEqual({ questions: [] });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/owner-questions",
        expect.any(Object),
      );
    });

    it("answerOwnerQuestion POSTs answer to /answer endpoint", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ question: { id: "oq-1" } }),
      });

      const { api } = await import("./client");
      await api.answerOwnerQuestion("oq-1", "go ahead");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/owner-questions/oq-1/answer",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ answer: "go ahead" }),
        }),
      );
    });

    it("dismissOwnerQuestion POSTs reason to /dismiss endpoint", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ question: { id: "oq-1" } }),
      });

      const { api } = await import("./client");
      await api.dismissOwnerQuestion("oq-1", "no longer needed");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/owner-questions/oq-1/dismiss",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reason: "no longer needed" }),
        }),
      );
    });
  });

  it("binds every approval request to the selected scope", async () => {
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ approvals: [] }),
    });

    const { api } = await import("./client");
    const digest = "a".repeat(64);
    await api.listApprovals("scope one");
    await api.approveApproval("scope one", "approval/one", digest);
    await api.rejectApproval("scope one", "approval/two", "unsafe");
    await api.approveAll("scope one", [{ id: "approval-three", digest }]);
    await api.rejectAll("scope one", "cancel batch");

    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
        ([path]) => path,
      ),
    ).toEqual([
      "/api/approvals?scopeId=scope%20one",
      "/api/approvals/approval%2Fone/approve?scopeId=scope%20one",
      "/api/approvals/approval%2Ftwo/reject?scopeId=scope%20one",
      "/api/approvals/approve-all?scopeId=scope%20one",
      "/api/approvals/reject-all?scopeId=scope%20one",
    ]);
  });

  describe("thin-client contract", () => {
    beforeEach(() => {
      Object.defineProperty(window, "location", {
        value: { search: "", pathname: "/", hash: "" },
        writable: true,
      });
    });

    it("getCapabilities requests and decodes readiness", async () => {
      const capabilities = {
        capabilities: [
          { id: "dashboard", moduleName: "web", status: "ready" },
          {
            id: "knowledge.semantic_search",
            moduleName: "knowledge",
            status: "unavailable",
            reason: "embedding_unsupported",
          },
        ],
        summary: { ready: 1, unavailable: 1, init_failed: 0 },
      };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(capabilities),
      });

      const { api } = await import("./client");
      const result = await api.getCapabilities();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/capabilities",
        expect.any(Object),
      );
      expect(result.summary.ready).toBe(1);
      expect(
        result.capabilities.find((c) => c.id === "dashboard")?.status,
      ).toBe("ready");
      expect(
        result.capabilities.find((c) => c.id === "knowledge.semantic_search")
          ?.reason,
      ).toBe("embedding_unsupported");
    });

    it("getIdentity decodes the dashboard-available identity arm", async () => {
      const identity = {
        scopeName: "kota",
        scopeRoot: "/workspace/kota",
        scopeRegistry: {
          rootScopeId: "global",
          defaultScopeId: "scope-kota",
          scopes: [
            { scopeId: "global", displayName: "Global" },
            {
              scopeId: "scope-kota",
              displayName: "kota",
              parentScopeId: "global",
              directoryRoot: "/workspace/kota",
            },
          ],
        },
        daemonVersion: "0.1.0",
        pid: 12345,
        startedAt: "2026-04-29T01:00:00.000Z",
        dashboard: { available: true, path: "/" },
      };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(identity),
      });

      const { api } = await import("./client");
      const result = await api.getIdentity();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/identity",
        expect.any(Object),
      );
      expect(result.scopeName).toBe("kota");
      if (!result.dashboard.available) {
        throw new Error("expected dashboard.available=true");
      }
      expect(result.dashboard.path).toBe("/");
    });

    it("getIdentity decodes the dashboard-unavailable identity arm with reason", async () => {
      const identity = {
        scopeName: "kota",
        scopeRoot: "/workspace/kota",
        scopeRegistry: {
          rootScopeId: "global",
          defaultScopeId: "scope-kota",
          scopes: [
            { scopeId: "global", displayName: "Global" },
            {
              scopeId: "scope-kota",
              displayName: "kota",
              parentScopeId: "global",
              directoryRoot: "/workspace/kota",
            },
          ],
        },
        daemonVersion: "0.1.0",
        pid: 12345,
        startedAt: "2026-04-29T01:00:00.000Z",
        dashboard: {
          available: false,
          reason: "web_ui_not_built",
          message: "Build the web client.",
        },
      };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(identity),
      });

      const { api } = await import("./client");
      const result = await api.getIdentity();

      if (result.dashboard.available) {
        throw new Error("expected dashboard.available=false");
      }
      expect(result.dashboard.reason).toBe("web_ui_not_built");
    });
  });
});
