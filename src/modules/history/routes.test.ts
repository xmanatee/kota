import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type {
  ConversationRecord,
  HistoryProvider,
} from "#core/modules/provider-types.js";
import { handleSearchHistory } from "./routes.js";

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

vi.mock("#core/modules/provider-registry.js", () => ({
  getHistoryProvider: vi.fn(),
}));

import { getHistoryProvider } from "#core/modules/provider-registry.js";

describe("history-routes", () => {
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
  });
});
