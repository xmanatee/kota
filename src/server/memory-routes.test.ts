import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { Memory } from "../memory/store.js";
import type { MemoryProvider } from "../provider-types.js";
import { handleGetMemory, handleListMemory } from "./memory-routes.js";

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (s: number) => { result.status = s; },
    end: (data: string) => { result.body = JSON.parse(data); },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem-abc",
    content: "Some memory content.",
    tags: ["agent"],
    created: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeProvider(entries: Memory[]): MemoryProvider {
  return {
    list: vi.fn(() => entries),
    save: vi.fn(() => "new-id"),
    search: vi.fn(() => entries),
    update: vi.fn(() => true),
    delete: vi.fn(() => true),
  };
}

vi.mock("../providers.js", () => ({
  getMemoryProvider: vi.fn(),
}));

import { getMemoryProvider } from "../providers.js";

describe("memory-routes", () => {
  describe("handleListMemory", () => {
    it("returns 200 with empty entries when store is empty", () => {
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      handleListMemory(res);
      expect(result.status).toBe(200);
      const body = result.body as { entries: unknown[] };
      expect(body.entries).toEqual([]);
    });

    it("returns list items with id, tags, created, and excerpt", () => {
      const entry = makeMemory({ content: "Hello world memory." });
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([entry]));
      const { res, result } = mockResponse();
      handleListMemory(res);
      expect(result.status).toBe(200);
      const body = result.body as { entries: Array<Record<string, unknown>> };
      expect(body.entries).toHaveLength(1);
      const item = body.entries[0];
      expect(item.id).toBe("mem-abc");
      expect(item.tags).toEqual(["agent"]);
      expect(item.created).toBe("2026-01-01T00:00:00Z");
      expect(item.excerpt).toBe("Hello world memory.");
    });

    it("truncates excerpt to 200 characters", () => {
      const longContent = "x".repeat(300);
      const entry = makeMemory({ content: longContent });
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([entry]));
      const { res, result } = mockResponse();
      handleListMemory(res);
      const body = result.body as { entries: Array<Record<string, unknown>> };
      expect((body.entries[0].excerpt as string).length).toBe(200);
    });

    it("returns 500 when provider throws", () => {
      vi.mocked(getMemoryProvider).mockReturnValue({
        ...makeProvider([]),
        list: vi.fn(() => { throw new Error("store error"); }),
      });
      const { res, result } = mockResponse();
      handleListMemory(res);
      expect(result.status).toBe(500);
      expect((result.body as { error: string }).error).toBe("store error");
    });
  });

  describe("handleGetMemory", () => {
    it("returns 200 with full entry when found", () => {
      const entry = makeMemory();
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([entry]));
      const { res, result } = mockResponse();
      handleGetMemory(res, "mem-abc");
      expect(result.status).toBe(200);
      const body = result.body as Memory;
      expect(body.id).toBe("mem-abc");
      expect(body.content).toBe("Some memory content.");
    });

    it("returns 404 when entry not found", () => {
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      handleGetMemory(res, "missing-id");
      expect(result.status).toBe(404);
    });

    it("returns 500 when provider throws", () => {
      vi.mocked(getMemoryProvider).mockReturnValue({
        ...makeProvider([]),
        list: vi.fn(() => { throw new Error("read error"); }),
      });
      const { res, result } = mockResponse();
      handleGetMemory(res, "any-id");
      expect(result.status).toBe(500);
    });
  });
});
