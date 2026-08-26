import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { apiError, getAccessToken, googleFetch, resolveSecretReference } from "./auth.js";

let requestMock = vi.fn();
const http = outboundHttpRequestPort((request) =>
  requestMock(String(request.url), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  })
);

describe("resolveSecretReference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns literal strings as-is", () => {
    expect(resolveSecretReference("my-client-id", () => null)).toBe("my-client-id");
  });

  it("resolves $ references through the supplied secret resolver", () => {
    expect(
      resolveSecretReference("$TEST_GWS_CLIENT", (key) =>
        key === "TEST_GWS_CLIENT" ? "resolved-value" : null,
      ),
    ).toBe("resolved-value");
  });

  it("returns empty string for unresolved references", () => {
    expect(resolveSecretReference("$MISSING_VAR", () => null)).toBe("");
  });
});

describe("getAccessToken", () => {
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
    vi.restoreAllMocks();
  });

  it("fetches a new token on first call", async () => {
    requestMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "fresh-token", expires_in: 3600 }),
    });

    const token = await getAccessToken("cid", "cs", "rt", http);
    expect(token).toBe("fresh-token");
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("caches token on subsequent calls", async () => {
    let callCount = 0;
    requestMock = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: `token-${callCount}`, expires_in: 3600 }),
      });
    });

    const t1 = await getAccessToken("a", "b", "c", http);
    const t2 = await getAccessToken("a", "b", "c", http);
    expect(t1).toBe("token-1");
    expect(t2).toBe("token-1");
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("refreshes when cache is near expiry", async () => {
    let callCount = 0;
    requestMock = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: `tok-${callCount}`, expires_in: 3600 }),
      });
    });

    await getAccessToken("x", "y", "z", http);
    // Advance time past the cache window (3600s - 60s buffer)
    vi.advanceTimersByTime(3600_000);
    const t2 = await getAccessToken("x", "y", "z", http);
    expect(t2).toBe("tok-2");
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("throws on non-ok response", async () => {
    requestMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("invalid_grant"),
    });

    await expect(getAccessToken("a", "b", "c", http)).rejects.toThrow(
      "Google token refresh failed (401)",
    );
  });

  it("sends correct body parameters", async () => {
    requestMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "t", expires_in: 3600 }),
    });

    await getAccessToken("my-cid", "my-cs", "my-rt", http);

    const call = requestMock.mock.calls[0];
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends Authorization header and returns parsed json", async () => {
    requestMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: "ok" }),
    });

    const result = await googleFetch(
      "my-token",
      "GET",
      "https://example.com/api",
      undefined,
      http,
    );
    expect(result).toEqual({ ok: true, status: 200, data: { data: "ok" } });

    const [, opts] = requestMock.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer my-token");
  });

  it("sends JSON body for POST", async () => {
    requestMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await googleFetch("tok", "POST", "https://example.com/api", { key: "val" }, http);
    const [, opts] = requestMock.mock.calls[0];
    expect(opts.body).toBe(JSON.stringify({ key: "val" }));
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("returns null data when json parsing fails", async () => {
    requestMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("bad json")),
    });

    const result = await googleFetch(
      "tok",
      "GET",
      "https://example.com/api",
      undefined,
      http,
    );
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
