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
});
