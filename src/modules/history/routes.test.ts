import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildConfiguredProject } from "#core/daemon/project-registry.js";
import type {
  ConversationData,
  ConversationMessage,
  ConversationRecord,
  HistoryProvider,
} from "#core/modules/provider-types.js";
import { HistoryProjectStores } from "./project-scope.js";
import { handleGetHistory, handleSearchHistory } from "./routes.js";

function mockResponse() {
  const result = { status: 0, body: null as unknown };
  const res = {
    setHeader: vi.fn(),
    writeHead: (s: number) => {
      result.status = s;
    },
    end: (data: string) => {
      result.body = JSON.parse(data);
    },
    on: vi.fn(),
  } as unknown as ServerResponse;
  return { res, result };
}

function searchRequest(query = ""): IncomingMessage {
  return { url: `/api/history/search${query}` } as unknown as IncomingMessage;
}

function makeRecord(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: "conv-abc",
    title: "First conversation",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T01:00:00Z",
    model: "claude",
    messageCount: 4,
    cwd: "/repo",
    source: "user",
    ...overrides,
  };
}

function makeData(messages: ConversationMessage[]): ConversationData {
  return {
    record: makeRecord({ messageCount: messages.length }),
    messages,
    compactionCount: 2,
    lastInputTokens: 1234,
  };
}

function longMessages(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message-${index}-${"x".repeat(40)}`,
  }));
}

function makeProvider(records: ConversationRecord[]): HistoryProvider {
  return {
    create: vi.fn(() => "new-id"),
    save: vi.fn(),
    load: vi.fn(() => null),
    list: vi.fn(() => records),
    getMostRecent: vi.fn(() => records[0] ?? null),
    findByPrefix: vi.fn(() => null),
    remove: vi.fn(() => true),
    cleanup: vi.fn(() => 0),
    supportsSemanticSearch: vi.fn(() => true),
    semanticSearch: vi.fn(async (_q: string, k: number) => records.slice(0, k)),
    reindex: vi.fn(async () => ({ indexed: 0, failed: 0, skipped: true })),
  };
}

function detailUrl(query = ""): URL {
  return new URL(`/api/history/conv-abc${query}`, "http://localhost");
}

vi.mock("#core/modules/provider-registry.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("#core/modules/provider-registry.js")>();
  return {
    ...actual,
    getHistoryProvider: vi.fn(),
    getProviderRegistry: vi.fn(() => null),
  };
});

import { getHistoryProvider } from "#core/modules/provider-registry.js";

describe("history-routes", () => {
  describe("handleGetHistory", () => {
    it("returns a bounded middle-page window for a 200+ message conversation", async () => {
      const messages = longMessages(205);
      const data = makeData(messages);
      const provider = makeProvider([data.record]);
      provider.load = vi.fn(() => data);
      vi.mocked(getHistoryProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();

      await handleGetHistory(
        res,
        "conv-abc",
        detailUrl("?view=window&offset=100&limit=5&contentLimit=16"),
      );

      expect(result.status).toBe(200);
      expect(provider.load).toHaveBeenCalledWith("conv-abc");
      const body = result.body as {
        view: "window";
        messageWindow: {
          offset: number;
          limit: number;
          total: number;
          returned: number;
          hasMoreBefore: boolean;
          hasMoreAfter: boolean;
        };
        messages: Array<{
          index: number;
          content: string;
          contentTruncation: {
            maxCharacters: number;
            originalCharacters: number;
            truncated: boolean;
          };
        }>;
      };
      expect(body.view).toBe("window");
      expect(body.messageWindow).toEqual({
        offset: 100,
        limit: 5,
        total: 205,
        returned: 5,
        hasMoreBefore: true,
        hasMoreAfter: true,
      });
      expect(body.messages.map((message) => message.index)).toEqual([
        100,
        101,
        102,
        103,
        104,
      ]);
      expect(body.messages[0].content).toBe("message-100-xxxx");
      expect(body.messages[0].contentTruncation).toEqual({
        maxCharacters: 16,
        originalCharacters: 52,
        truncated: true,
      });
    });

    it("returns metadata-only detail without loading the full conversation", async () => {
      const record = makeRecord({ messageCount: 205 });
      const provider = makeProvider([record]);
      provider.load = vi.fn(() => {
        throw new Error("metadata view should not load messages");
      });
      vi.mocked(getHistoryProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();

      await handleGetHistory(res, "conv-abc", detailUrl("?view=metadata"));

      expect(result.status).toBe(200);
      expect(provider.load).not.toHaveBeenCalled();
      expect(result.body).toEqual({
        view: "metadata",
        record,
        messageWindow: {
          offset: 0,
          limit: 0,
          total: 205,
          returned: 0,
          hasMoreBefore: false,
          hasMoreAfter: true,
        },
      });
    });

    it("returns explicit full detail when requested", async () => {
      const messages = longMessages(205);
      const data = makeData(messages);
      const provider = makeProvider([data.record]);
      provider.load = vi.fn(() => data);
      vi.mocked(getHistoryProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();

      await handleGetHistory(res, "conv-abc", detailUrl("?view=full"));

      expect(result.status).toBe(200);
      const body = result.body as {
        view: "full";
        messages: ConversationMessage[];
        messageWindow: { total: number; returned: number };
      };
      expect(body.view).toBe("full");
      expect(body.messages).toHaveLength(205);
      expect(body.messageWindow).toMatchObject({ total: 205, returned: 205 });
    });

    it.each([
      ["?view=bogus", "view must be one of metadata, window, full"],
      ["?view=window&offset=-1", "offset must be a non-negative integer"],
      ["?view=window&offset=1.5", "offset must be a non-negative integer"],
      ["?view=window&limit=0", "limit must be a positive integer"],
      ["?view=window&limit=abc", "limit must be a positive integer"],
      ["?view=metadata&limit=1", "limit is only valid for view=window"],
      ["?view=full&contentLimit=10", "contentLimit is only valid for view=window"],
    ])("rejects malformed detail query %s", async (query, expected) => {
      const provider = makeProvider([]);
      vi.mocked(getHistoryProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();

      await handleGetHistory(res, "conv-abc", detailUrl(query));

      expect(result.status).toBe(400);
      expect((result.body as { error: string }).error).toContain(expected);
    });
  });

  describe("handleSearchHistory", () => {
    it("returns ok:true with semantic conversations when semantic search is available", async () => {
      const record = makeRecord();
      const provider = makeProvider([record]);
      vi.mocked(getHistoryProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();
      await handleSearchHistory(
        searchRequest("?q=hello&semantic=true&limit=5"),
        res,
      );
      expect(result.status).toBe(200);
      expect(provider.semanticSearch).toHaveBeenCalledWith("hello", 5, {
        cwd: undefined,
        source: undefined,
      });
      expect(provider.list).not.toHaveBeenCalled();
      const body = result.body as { ok: true; conversations: ConversationRecord[] };
      expect(body.ok).toBe(true);
      expect(body.conversations).toHaveLength(1);
      expect(body.conversations[0].id).toBe("conv-abc");
    });

    it("returns ok:true with conversations:[] for an empty query (semantic path)", async () => {
      const provider = makeProvider([]);
      vi.mocked(getHistoryProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();
      await handleSearchHistory(searchRequest("?semantic=true"), res);
      expect(result.status).toBe(200);
      expect(provider.semanticSearch).toHaveBeenCalledWith("", 20, {
        cwd: undefined,
        source: undefined,
      });
      const body = result.body as { ok: true; conversations: ConversationRecord[] };
      expect(body.ok).toBe(true);
      expect(body.conversations).toEqual([]);
    });

    it("falls through to keyword search when semantic is not requested", async () => {
      const record = makeRecord({ title: "Keyword match" });
      const provider = makeProvider([record]);
      vi.mocked(getHistoryProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();
      await handleSearchHistory(
        searchRequest("?q=keyword&cwd=/repo&source=user&limit=10"),
        res,
      );
      expect(result.status).toBe(200);
      expect(provider.list).toHaveBeenCalledWith({
        search: "keyword",
        limit: 10,
        cwd: "/repo",
        source: "user",
      });
      expect(provider.semanticSearch).not.toHaveBeenCalled();
      const body = result.body as { ok: true; conversations: ConversationRecord[] };
      expect(body.ok).toBe(true);
      expect(body.conversations[0].title).toBe("Keyword match");
    });

    it("returns ok:false reason:semantic_unavailable when provider lacks semantic support", async () => {
      const provider = makeProvider([]);
      provider.supportsSemanticSearch = vi.fn(() => false);
      vi.mocked(getHistoryProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();
      await handleSearchHistory(searchRequest("?q=anything&semantic=true"), res);
      expect(result.status).toBe(200);
      expect(provider.semanticSearch).not.toHaveBeenCalled();
      expect(result.body).toEqual({ ok: false, reason: "semantic_unavailable" });
    });

    it("returns 500 with the provider's error message when semantic search throws", async () => {
      const provider = makeProvider([]);
      provider.semanticSearch = vi.fn(async () => {
        throw new Error("embed index missing");
      });
      vi.mocked(getHistoryProvider).mockReturnValue(provider);
      const { res, result } = mockResponse();
      await handleSearchHistory(searchRequest("?q=x&semantic=true"), res);
      expect(result.status).toBe(500);
      expect((result.body as { error: string }).error).toBe("embed index missing");
    });

    it("ignores invalid source values rather than forwarding them", async () => {
      const provider = makeProvider([]);
      vi.mocked(getHistoryProvider).mockReturnValue(provider);
      const { res } = mockResponse();
      await handleSearchHistory(
        searchRequest("?q=x&source=bogus"),
        res,
      );
      expect(provider.list).toHaveBeenCalledWith({
        search: "x",
        limit: 20,
        cwd: undefined,
        source: undefined,
      });
    });

    it("isolates project history entries and rejects unknown project ids", async () => {
      const root = mkdtempSync(join(tmpdir(), "kota-history-projects-"));
      try {
        const projectA = buildConfiguredProject({ projectDir: join(root, "a") });
        const projectB = buildConfiguredProject({ projectDir: join(root, "b") });
        const stores = new HistoryProjectStores({
          defaultProjectDir: projectA.projectDir,
          defaultProjectId: projectA.projectId,
          projects: [projectA, projectB],
        });

        const scopedA = stores.resolve(projectA.projectId);
        if (!scopedA.ok) throw new Error("project A did not resolve");
        const id = scopedA.store.create("claude-sonnet-4-6", projectA.projectDir);
        scopedA.store.save(
          id,
          [{ role: "user", content: "private alpha discussion" }],
          0,
          0,
        );

        const searchA = mockResponse();
        await handleSearchHistory(
          searchRequest(`?q=alpha&projectId=${projectA.projectId}`),
          searchA.res,
          stores,
        );
        expect(searchA.result.status).toBe(200);
        expect(
          (searchA.result.body as { ok: true; conversations: ConversationRecord[] })
            .conversations.map((conversation) => conversation.id),
        ).toEqual([id]);

        const searchB = mockResponse();
        await handleSearchHistory(
          searchRequest(`?q=alpha&projectId=${projectB.projectId}`),
          searchB.res,
          stores,
        );
        expect(searchB.result.status).toBe(200);
        expect(
          (searchB.result.body as { ok: true; conversations: ConversationRecord[] })
            .conversations,
        ).toEqual([]);

        const unknown = mockResponse();
        await handleSearchHistory(
          searchRequest("?q=alpha&projectId=missing-project"),
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
});
