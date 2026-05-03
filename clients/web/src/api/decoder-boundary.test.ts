/**
 * Strict-decode boundary tests for the production `api.*` surfaces.
 *
 * The web `api.capture` / `api.recall` / `api.answer` / `api.retract` /
 * `api.knowledge.search` / `api.memory.search` / `api.history.search` /
 * `api.tasks.search` / `api.answerLog` / `api.answerShow` / `api.getAttention`
 * / `api.getDigest` paths run the shared `clients/conformance/decoders.ts`
 * decoders at the boundary. A daemon response that drifts (unknown
 * discriminator value, missing required field) must throw a
 * `ContractDecodeError` so React Query surfaces the failure through its
 * `error` channel rather than letting an invalid object reach the UI.
 *
 * Mirrors the macOS Swift `Decodable` and mobile `parse*` runtime posture
 * the conformance suite already pins.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("api strict-decode boundary", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("api.capture rejects with ContractDecodeError on an unknown reason", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: false, reason: "future_reason" }),
    });

    const { api } = await import("./client");
    await expect(api.capture("anything")).rejects.toMatchObject({
      name: "ContractDecodeError",
    });
  });

  it("api.capture rejects with ContractDecodeError on an unknown record target", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          record: { target: "future_target", recordId: "x" },
        }),
    });

    const { api } = await import("./client");
    await expect(api.capture("anything")).rejects.toMatchObject({
      name: "ContractDecodeError",
    });
  });

  it("api.recall rejects with ContractDecodeError on an unknown reason", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: false, reason: "future_reason" }),
    });

    const { api } = await import("./client");
    await expect(api.recall("anything")).rejects.toMatchObject({
      name: "ContractDecodeError",
    });
  });

  it("api.knowledge.search rejects with ContractDecodeError on an unknown reason", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: false, reason: "future_reason" }),
    });

    const { api } = await import("./client");
    await expect(api.knowledge.search("anything")).rejects.toMatchObject({
      name: "ContractDecodeError",
    });
  });

  it("api.knowledge.search hits /api/knowledge/search with semantic=true", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, entries: [] }),
    });

    const { api } = await import("./client");
    await api.knowledge.search("how to capture", 25);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/knowledge/search?q=how+to+capture&semantic=true&limit=25",
      expect.any(Object),
    );
  });

  it("api.tasks.search hits /tasks/search (control route, not /api/)", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, tasks: [] }),
    });

    const { api } = await import("./client");
    await api.tasks.search("repair", 10);

    expect(fetchMock).toHaveBeenCalledWith(
      "/tasks/search?q=repair&semantic=true&limit=10",
      expect.any(Object),
    );
  });

  it("api.answer rejects on unknown citation source", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          answer: "yes",
          citations: [{ source: "future_source", id: "x" }],
          hits: [],
        }),
    });

    const { api } = await import("./client");
    await expect(api.answer("anything")).rejects.toMatchObject({
      name: "ContractDecodeError",
    });
  });

  it("api.getAttention rejects when items entries are not strings", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { items: [{ label: 123, detail: "broken" }] },
          text: "x",
        }),
    });

    const { api } = await import("./client");
    await expect(api.getAttention()).rejects.toMatchObject({
      name: "ContractDecodeError",
    });
  });

  it("api.capture decodes a well-formed memory success arm", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          record: { target: "memory", recordId: "mem-42" },
        }),
    });

    const { api } = await import("./client");
    const result = await api.capture("yo");
    if (!result.ok) throw new Error("expected ok=true");
    expect(result.record).toEqual({ target: "memory", recordId: "mem-42" });
  });
});
