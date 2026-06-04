import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildConfiguredProject } from "#core/daemon/scope-registry.js";
import type { KnowledgeEntry, KnowledgeProvider } from "#core/modules/provider-types.js";
import { KnowledgeProjectStores } from "./project-scope.js";
import { handleAddKnowledge, handleDeleteKnowledge, handleGetKnowledge, handleListKnowledge, handleSearchKnowledge, handleUpdateKnowledge } from "./routes.js";

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

function listRequest(query = ""): IncomingMessage {
  return { url: `/api/knowledge${query}` } as unknown as IncomingMessage;
}

function makeRequest(url: string, body: unknown): IncomingMessage {
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

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "entry-abc",
    title: "Test Entry",
    type: "note",
    tags: ["testing"],
    status: "active",
    created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    content: "Some content here.",
    meta: {},
    ...overrides,
  };
}

function makeProvider(entries: KnowledgeEntry[]): KnowledgeProvider {
  return {
    list: vi.fn(() => entries),
    read: vi.fn((id: string) => entries.find((e) => e.id === id) ?? null),
    create: vi.fn(() => "new-id"),
    update: vi.fn(() => true),
    delete: vi.fn(() => true),
    search: vi.fn(() => entries),
    count: vi.fn(() => entries.length),
    supportsSemanticSearch: vi.fn(() => true),
    semanticSearch: vi.fn(async (_q: string, topK: number) => entries.slice(0, topK)),
    reindex: vi.fn(async () => ({ indexed: 0, failed: 0, skipped: true })),
  };
}

vi.mock("#core/modules/provider-registry.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("#core/modules/provider-registry.js")>();
  return {
    ...actual,
    getKnowledgeProvider: vi.fn(),
    getProviderRegistry: vi.fn(() => null),
  };
});

import { getKnowledgeProvider } from "#core/modules/provider-registry.js";

describe("knowledge-routes", () => {
  describe("handleListKnowledge", () => {
    it("returns 200 with empty entries when store is empty", () => {
      vi.mocked(getKnowledgeProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      handleListKnowledge(listRequest(), res);
      expect(result.status).toBe(200);
      const body = result.body as { entries: unknown[] };
      expect(body.entries).toEqual([]);
    });

    it("returns full entries with content, tags, timestamps, and meta", () => {
      const entry = makeEntry({ content: "Hello world content." });
      vi.mocked(getKnowledgeProvider).mockReturnValue(makeProvider([entry]));
      const { res, result } = mockResponse();
      handleListKnowledge(listRequest(), res);
      expect(result.status).toBe(200);
      const body = result.body as { entries: KnowledgeEntry[] };
      expect(body.entries).toHaveLength(1);
      const item = body.entries[0];
      expect(item.id).toBe("entry-abc");
      expect(item.title).toBe("Test Entry");
      expect(item.type).toBe("note");
      expect(item.tags).toEqual(["testing"]);
      expect(item.status).toBe("active");
      expect(item.content).toBe("Hello world content.");
      expect(item.created).toBe("2026-01-01T00:00:00Z");
      expect(item.updated).toBe("2026-01-01T00:00:00Z");
      expect(item.meta).toEqual({});
    });

    it("forwards scope/tag/type/status query params to provider.list", () => {
      const provider = makeProvider([]);
      vi.mocked(getKnowledgeProvider).mockReturnValue(provider);
      const { res } = mockResponse();
      handleListKnowledge(
        listRequest("?scope=project&tag=foo&type=note&status=active"),
        res,
      );
      expect(provider.list).toHaveBeenCalledWith({
        scope: "project",
        tag: "foo",
        type: "note",
        status: "active",
      });
    });

    it("returns 500 when provider throws", () => {
      vi.mocked(getKnowledgeProvider).mockReturnValue({
        ...makeProvider([]),
        list: vi.fn(() => { throw new Error("store error"); }),
      });
      const { res, result } = mockResponse();
      handleListKnowledge(listRequest(), res);
      expect(result.status).toBe(500);
      expect((result.body as { error: string }).error).toBe("store error");
    });
  });

  describe("handleGetKnowledge", () => {
    it("returns 200 with full entry when found", () => {
      const entry = makeEntry();
      vi.mocked(getKnowledgeProvider).mockReturnValue(makeProvider([entry]));
      const { res, result } = mockResponse();
      handleGetKnowledge(res, "entry-abc");
      expect(result.status).toBe(200);
      const body = result.body as KnowledgeEntry;
      expect(body.id).toBe("entry-abc");
      expect(body.content).toBe("Some content here.");
    });

    it("returns 404 when entry not found", () => {
      vi.mocked(getKnowledgeProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      handleGetKnowledge(res, "missing-id");
      expect(result.status).toBe(404);
    });

    it("returns 500 when provider throws", () => {
      vi.mocked(getKnowledgeProvider).mockReturnValue({
        ...makeProvider([]),
        read: vi.fn(() => { throw new Error("read error"); }),
      });
      const { res, result } = mockResponse();
      handleGetKnowledge(res, "any-id");
      expect(result.status).toBe(500);
    });
  });

  describe("handleAddKnowledge", () => {
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
      vi.mocked(getKnowledgeProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();
      await handleAddKnowledge(makeRequest({ title: "My Entry", content: "body text", type: "note", tags: ["foo"] }), res);
      expect(result.status).toBe(201);
      expect((result.body as { id: string }).id).toBe("new-id");
      expect(provider.create).toHaveBeenCalledWith(expect.objectContaining({ title: "My Entry", content: "body text", type: "note", tags: ["foo"] }));
    });

    it("returns 400 when title is missing", async () => {
      vi.mocked(getKnowledgeProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      await handleAddKnowledge(makeRequest({ content: "no title" }), res);
      expect(result.status).toBe(400);
    });

    it("returns 500 when provider throws", async () => {
      vi.mocked(getKnowledgeProvider).mockReturnValue({
        ...makeProvider([]),
        create: vi.fn(() => { throw new Error("create error"); }),
      });
      const { res, result } = mockResponse();
      await handleAddKnowledge(makeRequest({ title: "T" }), res);
      expect(result.status).toBe(500);
    });
  });

  describe("project-scoped routing", () => {
    it("isolates project entries and rejects unknown project ids", async () => {
      const root = mkdtempSync(join(tmpdir(), "kota-knowledge-projects-"));
      try {
        const projectA = buildConfiguredProject({ projectDir: join(root, "a") });
        const projectB = buildConfiguredProject({ projectDir: join(root, "b") });
        const stores = new KnowledgeProjectStores({
          defaultProjectDir: projectA.projectDir,
          defaultProjectId: projectA.projectId,
          projects: [projectA, projectB],
          globalDir: join(root, "global"),
        });

        const addA = mockResponse();
        await handleAddKnowledge(
          makeRequest(`/api/knowledge?projectId=${projectA.projectId}`, {
            title: "Alpha project entry",
            content: "private alpha notes",
          }),
          addA.res,
          stores,
        );
        expect(addA.result.status).toBe(201);
        const createdId = (addA.result.body as { id: string }).id;

        const searchA = mockResponse();
        await handleSearchKnowledge(
          listRequest(`/search?q=alpha&projectId=${projectA.projectId}`),
          searchA.res,
          stores,
        );
        expect(searchA.result.status).toBe(200);
        expect(
          (searchA.result.body as { ok: true; entries: KnowledgeEntry[] }).entries.map((entry) => entry.id),
        ).toEqual([createdId]);

        const searchB = mockResponse();
        await handleSearchKnowledge(
          listRequest(`/search?q=alpha&projectId=${projectB.projectId}`),
          searchB.res,
          stores,
        );
        expect(searchB.result.status).toBe(200);
        expect(
          (searchB.result.body as { ok: true; entries: KnowledgeEntry[] }).entries,
        ).toEqual([]);

        const unknown = mockResponse();
        handleListKnowledge(listRequest("?projectId=missing-project"), unknown.res, stores);
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

  describe("handleUpdateKnowledge", () => {
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

    it("returns 200 with updated entry on valid update", async () => {
      const entry = makeEntry();
      const updatedEntry = makeEntry({ title: "New Title", updated: "2026-02-01T00:00:00Z" });
      const provider = makeProvider([entry]);
      vi.mocked(provider.read)
        .mockReturnValueOnce(entry)
        .mockReturnValueOnce(updatedEntry);
      vi.mocked(getKnowledgeProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();
      await handleUpdateKnowledge(makeRequest({ title: "New Title" }), res, "entry-abc");
      expect(result.status).toBe(200);
      expect(provider.update).toHaveBeenCalledWith("entry-abc", expect.objectContaining({ title: "New Title" }));
      expect((result.body as KnowledgeEntry).title).toBe("New Title");
    });

    it("returns 404 when entry not found", async () => {
      const provider = makeProvider([]);
      vi.mocked(getKnowledgeProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();
      await handleUpdateKnowledge(makeRequest({ title: "Anything" }), res, "missing-id");
      expect(result.status).toBe(404);
    });

    it("returns 500 when provider throws", async () => {
      const entry = makeEntry();
      const provider = makeProvider([entry]);
      vi.mocked(provider.update).mockImplementation(() => { throw new Error("update error"); });
      vi.mocked(getKnowledgeProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();
      await handleUpdateKnowledge(makeRequest({ title: "T" }), res, "entry-abc");
      expect(result.status).toBe(500);
    });
  });

  describe("handleDeleteKnowledge", () => {
    it("returns 200 when entry deleted", () => {
      vi.mocked(getKnowledgeProvider).mockReturnValue(makeProvider([]));
      const { res, result } = mockResponse();
      handleDeleteKnowledge(res, "entry-abc");
      expect(result.status).toBe(200);
      expect((result.body as { deleted: string }).deleted).toBe("entry-abc");
    });

    it("returns 404 when entry not found", () => {
      vi.mocked(getKnowledgeProvider).mockReturnValue({
        ...makeProvider([]),
        delete: vi.fn(() => false),
      });
      const { res, result } = mockResponse();
      handleDeleteKnowledge(res, "missing");
      expect(result.status).toBe(404);
    });

    it("returns 500 when provider throws", () => {
      vi.mocked(getKnowledgeProvider).mockReturnValue({
        ...makeProvider([]),
        delete: vi.fn(() => { throw new Error("del error"); }),
      });
      const { res, result } = mockResponse();
      handleDeleteKnowledge(res, "any-id");
      expect(result.status).toBe(500);
    });
  });
});
