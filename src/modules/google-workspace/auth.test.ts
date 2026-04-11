import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, getAccessToken, googleFetch, resolveEnv } from "./auth.js";

describe("resolveEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns literal strings as-is", () => {
    expect(resolveEnv("my-client-id")).toBe("my-client-id");
  });

  it("resolves $ENV_VAR from process.env", () => {
    vi.stubEnv("TEST_GWS_CLIENT", "resolved-value");
    expect(resolveEnv("$TEST_GWS_CLIENT")).toBe("resolved-value");
  });

  it("returns empty string for unset env var", () => {
    delete process.env.MISSING_VAR;
    expect(resolveEnv("$MISSING_VAR")).toBe("");
  });
});

describe("getAccessToken", () => {
  const originalFetch = globalThis.fetch;
  // Each test jumps far enough into the future to expire any prior cached token.
  // The cache stores expiresAt = Date.now() + expires_in*1000, so jumping > 1 hour
  // past the last test's time guarantees a miss.
  let epoch = Date.now() + 100_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    epoch += 100_000_000;
    vi.setSystemTime(epoch);
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches a new token on first call", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "fresh-token", expires_in: 3600 }),
    });

    const token = await getAccessToken("cid", "cs", "rt");
    expect(token).toBe("fresh-token");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("caches token on subsequent calls", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: `token-${callCount}`, expires_in: 3600 }),
      });
    });

    const t1 = await getAccessToken("a", "b", "c");
    const t2 = await getAccessToken("a", "b", "c");
    expect(t1).toBe("token-1");
    expect(t2).toBe("token-1");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("refreshes when cache is near expiry", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: `tok-${callCount}`, expires_in: 3600 }),
      });
    });

    await getAccessToken("x", "y", "z");
    // Advance time past the cache window (3600s - 60s buffer)
    vi.advanceTimersByTime(3600_000);
    const t2 = await getAccessToken("x", "y", "z");
    expect(t2).toBe("tok-2");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("invalid_grant"),
    });

    await expect(getAccessToken("a", "b", "c")).rejects.toThrow(
      "Google token refresh failed (401)",
    );
  });

  it("sends correct body parameters", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "t", expires_in: 3600 }),
    });

    await getAccessToken("my-cid", "my-cs", "my-rt");

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://oauth2.googleapis.com/token");
    expect(call[1].method).toBe("POST");
    const body = new URLSearchParams(call[1].body);
    expect(body.get("client_id")).toBe("my-cid");
    expect(body.get("client_secret")).toBe("my-cs");
    expect(body.get("refresh_token")).toBe("my-rt");
    expect(body.get("grant_type")).toBe("refresh_token");
  });
});

describe("googleFetch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends Authorization header and returns parsed json", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: "ok" }),
    });

    const result = await googleFetch("my-token", "GET", "https://example.com/api");
    expect(result).toEqual({ ok: true, status: 200, data: { data: "ok" } });

    const [, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer my-token");
  });

  it("sends JSON body for POST", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await googleFetch("tok", "POST", "https://example.com/api", { key: "val" });
    const [, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.body).toBe(JSON.stringify({ key: "val" }));
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("returns null data when json parsing fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("bad json")),
    });

    const result = await googleFetch("tok", "GET", "https://example.com/api");
    expect(result).toEqual({ ok: false, status: 500, data: null });
  });
});

describe("apiError", () => {
  it("formats error with nested message", () => {
    const result = apiError("list events", 403, { error: { message: "Forbidden" } });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("403");
    expect(result.content).toContain("list events");
    expect(result.content).toContain("Forbidden");
  });

  it("falls back to JSON.stringify when no error.message", () => {
    const result = apiError("send", 500, { unexpected: true });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("500");
    expect(result.content).toContain("unexpected");
  });
});
