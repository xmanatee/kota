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
});
