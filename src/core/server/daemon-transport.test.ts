import { afterEach, describe, expect, it, vi } from "vitest";
import { daemonTransportFromAddress } from "./daemon-transport.js";

const originalFetch = globalThis.fetch;
const ADDRESS = {
  port: 43210,
  pid: 1234,
  startedAt: "2026-08-23T12:00:00.000Z",
  token: "test-token",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("daemon SSE transport", () => {
  it("surfaces stream connection failures to the consumer", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );
    const transport = daemonTransportFromAddress(ADDRESS);

    const next = transport.events().next();

    await expect(next).rejects.toThrow("Daemon SSE stream failed with HTTP 503");
  });

  it("surfaces malformed and oversized stream frames", async () => {
    const transport = daemonTransportFromAddress(ADDRESS);
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response("id: 1\nevent: task.changed\ndata: {invalid}\n\n"),
    );

    await expect(transport.events().next()).rejects.toThrow(SyntaxError);

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response("x".repeat(1_000_001)),
    );
    await expect(transport.events().next()).rejects.toThrow(
      "Daemon SSE frame exceeds 1000000 characters",
    );
  });

  it("accepts heartbeats and rejects incomplete event frames", async () => {
    const transport = daemonTransportFromAddress(ADDRESS);
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(': heartbeat\n\nid: 1\nevent: task.changed\ndata: {"id":"task-1"}\n\n'),
    );

    await expect(transport.events().next()).resolves.toMatchObject({
      value: { id: "1", type: "task.changed", payload: { id: "task-1" } },
      done: false,
    });

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response("id: 2\nevent: task.changed\n\n"),
    );
    await expect(transport.events().next()).rejects.toThrow(
      "Daemon SSE frame is missing id, event, or data",
    );
  });

  it("rejects unsupported methods before dispatch", async () => {
    globalThis.fetch = vi.fn();
    const transport = daemonTransportFromAddress(ADDRESS);

    await expect(transport.fetchRaw("/health", { method: "TRACE" })).rejects.toThrow(
      "Unsupported daemon HTTP method: TRACE",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("releases external abort listeners after a completed request", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const transport = daemonTransportFromAddress(ADDRESS);
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");

    await transport.requestStrict("GET", "/health", undefined, {
      signal: controller.signal,
    });

    expect(added).toHaveBeenCalledWith("abort", expect.any(Function), {
      once: true,
    });
    expect(removed).toHaveBeenCalledWith(
      "abort",
      added.mock.calls[0]?.[1],
    );
  });
});
