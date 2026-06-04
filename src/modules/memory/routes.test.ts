import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildConfiguredProject } from "#core/daemon/scope-registry.js";
import type { Memory, MemoryProvider } from "#core/modules/provider-types.js";
import { MemoryProjectStores } from "./project-scope.js";
import { handleAddMemory, handleDeleteMemory, handleGetMemory, handleListMemory, handleSearchMemory, handleUpdateMemory } from "./routes.js";

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

function listRequest(url = "/api/memory"): IncomingMessage {
  return { url } as unknown as IncomingMessage;
}

function makeRequestWithUrl(url: string, body: unknown): IncomingMessage {
  const data = JSON.stringify(body);
  const req = {
    url,
    on: (event: string, cb: (chunk?: Buffer | string) => void) => {
      if (event === "data") cb(Buffer.from(data));
      if (event === "end") cb();
    },
  } as unknown as IncomingMessage;
  return req;
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
    supportsSemanticSearch: vi.fn(() => true),
    semanticSearch: vi.fn(async (_q: string, k: number) => entries.slice(0, k)),
    reindex: vi.fn(async () => ({ indexed: 0, failed: 0, skipped: true })),
  };
}

vi.mock("#core/modules/provider-registry.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("#core/modules/provider-registry.js")>();
  return {
    ...actual,
    getMemoryProvider: vi.fn(),
    getProviderRegistry: vi.fn(() => null),
  };
});

import { getMemoryProvider } from "#core/modules/provider-registry.js";

describe("memory-routes", () => {
  describe("handleListMemory", () => {
    it("returns 200 with empty entries when store is empty", () => {
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      handleListMemory(listRequest(), res);
      expect(result.status).toBe(200);
      const body = result.body as { entries: unknown[] };
      expect(body.entries).toEqual([]);
    });

    it("returns list items with id, tags, created, and excerpt", () => {
      const entry = makeMemory({ content: "Hello world memory." });
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([entry]));
      const { res, result } = mockResponse();
      handleListMemory(listRequest(), res);
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
      handleListMemory(listRequest(), res);
      const body = result.body as { entries: Array<Record<string, unknown>> };
      expect((body.entries[0].excerpt as string).length).toBe(200);
    });

    it("returns 500 when provider throws", () => {
      vi.mocked(getMemoryProvider).mockReturnValue({
        ...makeProvider([]),
        list: vi.fn(() => { throw new Error("store error"); }),
      });
      const { res, result } = mockResponse();
      handleListMemory(listRequest(), res);
      expect(result.status).toBe(500);
      expect((result.body as { error: string }).error).toBe("store error");
    });
  });

  describe("handleGetMemory", () => {
    it("returns 200 with full entry when found", () => {
      const entry = makeMemory();
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([entry]));
      const { res, result } = mockResponse();
      handleGetMemory(listRequest(), res, "mem-abc");
      expect(result.status).toBe(200);
      const body = result.body as Memory;
      expect(body.id).toBe("mem-abc");
      expect(body.content).toBe("Some memory content.");
    });

    it("returns 404 when entry not found", () => {
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      handleGetMemory(listRequest(), res, "missing-id");
      expect(result.status).toBe(404);
    });

    it("returns 500 when provider throws", () => {
      vi.mocked(getMemoryProvider).mockReturnValue({
        ...makeProvider([]),
        list: vi.fn(() => { throw new Error("read error"); }),
      });
      const { res, result } = mockResponse();
      handleGetMemory(listRequest(), res, "any-id");
      expect(result.status).toBe(500);
    });
  });

  describe("handleAddMemory", () => {
    function makeRequest(body: unknown): IncomingMessage {
      const data = JSON.stringify(body);
      const req = {
        on: (event: string, cb: (chunk?: Buffer | string) => void) => {
          if (event === "data") cb(Buffer.from(data));
          if (event === "end") cb();
        },
      } as unknown as IncomingMessage;
      return req;
    }

    it("returns 201 with generated id on success", async () => {
      const provider = makeProvider([]);
      vi.mocked(getMemoryProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();
      await handleAddMemory(makeRequest({ content: "hello world", tags: ["a"] }), res);
      expect(result.status).toBe(201);
      expect((result.body as { id: string }).id).toBe("new-id");
      expect(provider.save).toHaveBeenCalledWith("hello world", ["a"]);
    });

    it("returns 400 when content is missing", async () => {
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      await handleAddMemory(makeRequest({}), res);
      expect(result.status).toBe(400);
    });

    it("returns 500 when provider throws", async () => {
      vi.mocked(getMemoryProvider).mockReturnValue({
        ...makeProvider([]),
        save: vi.fn(() => { throw new Error("save error"); }),
      });
      const { res, result } = mockResponse();
      await handleAddMemory(makeRequest({ content: "x" }), res);
      expect(result.status).toBe(500);
    });
  });

  describe("project-scoped routing", () => {
    it("isolates project entries and rejects unknown project ids", async () => {
      const root = mkdtempSync(join(tmpdir(), "kota-memory-projects-"));
      try {
        const projectA = buildConfiguredProject({ projectDir: join(root, "a") });
        const projectB = buildConfiguredProject({ projectDir: join(root, "b") });
        const stores = new MemoryProjectStores({
          defaultProjectDir: projectA.projectDir,
          defaultProjectId: projectA.projectId,
          projects: [projectA, projectB],
        });

        const addA = mockResponse();
        await handleAddMemory(
          makeRequestWithUrl(`/api/memory?projectId=${projectA.projectId}`, {
            content: "private alpha memory",
            tags: ["alpha"],
          }),
          addA.res,
          stores,
        );
        expect(addA.result.status).toBe(201);
        const createdId = (addA.result.body as { id: string }).id;

        const searchA = mockResponse();
        await handleSearchMemory(
          listRequest(`/api/memory/search?q=alpha&projectId=${projectA.projectId}`),
          searchA.res,
          stores,
        );
        expect(searchA.result.status).toBe(200);
        expect(
          (searchA.result.body as { ok: true; entries: Memory[] }).entries.map((entry) => entry.id),
        ).toEqual([createdId]);

        const searchB = mockResponse();
        await handleSearchMemory(
          listRequest(`/api/memory/search?q=alpha&projectId=${projectB.projectId}`),
          searchB.res,
          stores,
        );
        expect(searchB.result.status).toBe(200);
        expect(
          (searchB.result.body as { ok: true; entries: Memory[] }).entries,
        ).toEqual([]);

        const unknown = mockResponse();
        handleListMemory(
          listRequest("?projectId=missing-project"),
          unknown.res,
          stores,
        );
        expect(unknown.result.status).toBe(404);
        expect(unknown.result.body).toEqual({
          error: "Unknown project",
          reason: "unknown_project",
          projectId: "missing-project",
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe("handleUpdateMemory", () => {
    function makeRequest(body: unknown): IncomingMessage {
      const data = JSON.stringify(body);
      const req = {
        on: (event: string, cb: (chunk?: Buffer | string) => void) => {
          if (event === "data") cb(Buffer.from(data));
          if (event === "end") cb();
        },
      } as unknown as IncomingMessage;
      return req;
    }

    it("returns 200 with updated entry on success", async () => {
      const entry = makeMemory({ content: "original content", tags: ["old"] });
      const provider = makeProvider([entry]);
      provider.update = vi.fn(() => true);
      // After update, list returns modified entry
      provider.list = vi.fn()
        .mockReturnValueOnce([entry])  // existence check
        .mockReturnValueOnce([{ ...entry, content: "new content", tags: ["new"] }]);  // post-update fetch
      vi.mocked(getMemoryProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();
      await handleUpdateMemory(makeRequest({ content: "new content", tags: ["new"] }), res, "mem-abc");
      expect(result.status).toBe(200);
      expect(provider.update).toHaveBeenCalledWith("mem-abc", { content: "new content", tags: ["new"] });
    });

    it("returns 404 when entry not found", async () => {
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      await handleUpdateMemory(makeRequest({ content: "x" }), res, "missing-id");
      expect(result.status).toBe(404);
    });

    it("returns 400 on invalid body", async () => {
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      const badReq = {
        on: (event: string, cb: (chunk?: Buffer | string) => void) => {
          if (event === "error") cb();
        },
      } as unknown as IncomingMessage;
      await handleUpdateMemory(badReq, res, "mem-abc");
      expect(result.status).toBe(400);
    });
  });

  describe("handleDeleteMemory", () => {
    it("returns 200 when entry deleted", () => {
      vi.mocked(getMemoryProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      handleDeleteMemory(listRequest(), res, "mem-abc");
      expect(result.status).toBe(200);
      expect((result.body as { deleted: string }).deleted).toBe("mem-abc");
    });

    it("returns 404 when entry not found", () => {
      vi.mocked(getMemoryProvider).mockReturnValue({
        ...makeProvider([]),
        delete: vi.fn(() => false),
      });
      const { res, result } = mockResponse();
      handleDeleteMemory(listRequest(), res, "missing");
      expect(result.status).toBe(404);
    });

    it("returns 500 when provider throws", () => {
      vi.mocked(getMemoryProvider).mockReturnValue({
        ...makeProvider([]),
        delete: vi.fn(() => { throw new Error("del error"); }),
      });
      const { res, result } = mockResponse();
      handleDeleteMemory(listRequest(), res, "any-id");
      expect(result.status).toBe(500);
    });
  });
});
