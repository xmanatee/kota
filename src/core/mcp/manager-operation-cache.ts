import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type {
  McpCacheHints,
  McpListPromptsPage,
  McpListResourcesPage,
  McpListResourceTemplatesPage,
} from "./client.js";
import type { McpRemoteSkillCatalog } from "./client-remote-skills.js";
import type { McpOperationEntry } from "./manager-tool-registry.js";

export type McpCachedListOperationKind =
  | "resources/list"
  | "resources/templates/list"
  | "prompts/list";

type McpCacheableListPage =
  | McpListResourcesPage
  | McpListResourceTemplatesPage
  | McpListPromptsPage;

type McpListCacheEntry<TPage extends McpCacheableListPage> = {
  page: TPage;
  receivedAtMs: number;
};

type McpListCacheSource = "cache" | "server";
type McpListCacheReason = "fresh" | "missing" | "expired" | "ttl-not-positive" | "list_changed";

type McpListCacheMetadata = McpCacheHints & {
  server: string;
  operation: McpCachedListOperationKind;
  cursor: string | null;
  source: McpListCacheSource;
  reason: McpListCacheReason;
  receivedAt: string;
  expiresAt: string | null;
};

type McpRemoteSkillCatalogCacheEntry = {
  catalog: Extract<McpRemoteSkillCatalog, { status: "enumerated" }>;
  receivedAtMs: number;
};

type McpRemoteSkillCatalogCacheReason = McpListCacheReason;
type McpRemoteSkillCatalogCacheMetadata = McpCacheHints & {
  server: string;
  operation: "skills/list";
  source: McpListCacheSource;
  reason: McpRemoteSkillCatalogCacheReason;
  receivedAt: string;
  expiresAt: string | null;
};

export class McpOperationCache {
  private listEntries = new Map<string, McpListCacheEntry<McpCacheableListPage>>();
  private listInvalidations = new Map<string, "list_changed">();
  private skillCatalogs = new Map<string, McpRemoteSkillCatalogCacheEntry>();
  private skillInvalidations = new Map<string, "list_changed">();

  invalidateLists(serverName: string, operations: McpCachedListOperationKind[]): void {
    for (const operation of operations) {
      const prefix = this.listOperationPrefix(serverName, operation);
      for (const key of this.listEntries.keys()) {
        if (key.startsWith(prefix)) this.listEntries.delete(key);
      }
      this.listInvalidations.set(prefix, "list_changed");
    }
  }

  invalidateSkills(serverName: string): void {
    const prefix = this.skillPrefix(serverName);
    for (const key of this.skillCatalogs.keys()) {
      if (key.startsWith(prefix)) this.skillCatalogs.delete(key);
    }
    this.skillInvalidations.set(prefix, "list_changed");
  }

  async listPages<TPage extends McpCacheableListPage>(
    entry: McpOperationEntry,
    operation: McpCachedListOperationKind,
    fetchPage: (cursor: string | undefined) => Promise<TPage>,
  ): Promise<{ pages: TPage[]; meta: KotaJsonObject }> {
    const pages: TPage[] = [];
    const cache: McpListCacheMetadata[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await this.listPage(entry, operation, cursor, fetchPage);
      pages.push(result.page);
      cache.push(result.cache);
      cursor = result.page.nextCursor;
      if (cursor !== undefined) {
        if (seenCursors.has(cursor)) {
          throw new Error(`Malformed MCP ${operation} result: repeated nextCursor`);
        }
        seenCursors.add(cursor);
      }
    } while (cursor !== undefined);
    return { pages, meta: { mcp: { cache } } };
  }

  async remoteSkillCatalog(
    entry: McpOperationEntry,
  ): Promise<{ catalog: McpRemoteSkillCatalog; meta?: KotaJsonObject }> {
    const key = this.skillKey(entry);
    const prefix = this.skillPrefix(entry.serverName);
    const cached = this.skillCatalogs.get(key);
    const now = Date.now();
    if (cached && cached.catalog.cache.ttlMs > 0) {
      if (now < cached.receivedAtMs + cached.catalog.cache.ttlMs) {
        const metadata = this.skillMetadata({
          entry,
          source: "cache",
          reason: "fresh",
          catalog: cached.catalog,
          receivedAtMs: cached.receivedAtMs,
        });
        return { catalog: cached.catalog, meta: { mcp: { cache: [metadata] } } };
      }
    }
    const invalidated = this.skillInvalidations.get(prefix);
    const reason: McpRemoteSkillCatalogCacheReason = invalidated
      ?? (cached
        ? cached.catalog.cache.ttlMs <= 0 ? "ttl-not-positive" : "expired"
        : "missing");
    const catalog = await entry.client.listRemoteSkills();
    if (catalog.status !== "enumerated") {
      this.skillCatalogs.delete(key);
      this.skillInvalidations.delete(prefix);
      return { catalog };
    }
    const receivedAtMs = Date.now();
    if (catalog.cache.ttlMs > 0) this.skillCatalogs.set(key, { catalog, receivedAtMs });
    else this.skillCatalogs.delete(key);
    this.skillInvalidations.delete(prefix);
    const metadata = this.skillMetadata({
      entry,
      source: "server",
      reason: catalog.cache.ttlMs <= 0 && reason === "missing" ? "ttl-not-positive" : reason,
      catalog,
      receivedAtMs,
    });
    return { catalog, meta: { mcp: { cache: [metadata] } } };
  }

  clear(): void {
    this.listEntries.clear();
    this.listInvalidations.clear();
    this.skillCatalogs.clear();
    this.skillInvalidations.clear();
  }

  private async listPage<TPage extends McpCacheableListPage>(
    entry: McpOperationEntry,
    operation: McpCachedListOperationKind,
    cursor: string | undefined,
    fetchPage: (cursor: string | undefined) => Promise<TPage>,
  ): Promise<{ page: TPage; cache: McpListCacheMetadata }> {
    const key = this.listKey(entry, operation, cursor);
    const prefix = this.listOperationPrefix(entry.serverName, operation);
    const cached = this.listEntries.get(key) as McpListCacheEntry<TPage> | undefined;
    const now = Date.now();
    if (cached && cached.page.cache.ttlMs > 0 && now < cached.receivedAtMs + cached.page.cache.ttlMs) {
      return {
        page: cached.page,
        cache: this.listMetadata({
          entry, operation, cursor, source: "cache", reason: "fresh",
          page: cached.page, receivedAtMs: cached.receivedAtMs,
        }),
      };
    }
    const invalidated = this.listInvalidations.get(prefix);
    const reason: McpListCacheReason = invalidated
      ?? (cached ? cached.page.cache.ttlMs <= 0 ? "ttl-not-positive" : "expired" : "missing");
    const page = await fetchPage(cursor);
    const receivedAtMs = Date.now();
    if (page.cache.ttlMs > 0) this.listEntries.set(key, { page, receivedAtMs });
    else this.listEntries.delete(key);
    this.listInvalidations.delete(prefix);
    return {
      page,
      cache: this.listMetadata({
        entry, operation, cursor, source: "server",
        reason: page.cache.ttlMs <= 0 && reason === "missing" ? "ttl-not-positive" : reason,
        page, receivedAtMs,
      }),
    };
  }

  private listMetadata(args: {
    entry: McpOperationEntry;
    operation: McpCachedListOperationKind;
    cursor: string | undefined;
    source: McpListCacheSource;
    reason: McpListCacheReason;
    page: McpCacheableListPage;
    receivedAtMs: number;
  }): McpListCacheMetadata {
    return {
      server: args.entry.serverName,
      operation: args.operation,
      cursor: args.cursor ?? null,
      source: args.source,
      reason: args.reason,
      ttlMs: args.page.cache.ttlMs,
      cacheScope: args.page.cache.cacheScope,
      receivedAt: new Date(args.receivedAtMs).toISOString(),
      expiresAt: args.page.cache.ttlMs > 0
        ? new Date(args.receivedAtMs + args.page.cache.ttlMs).toISOString()
        : null,
    };
  }

  private skillMetadata(args: {
    entry: McpOperationEntry;
    source: McpListCacheSource;
    reason: McpRemoteSkillCatalogCacheReason;
    catalog: Extract<McpRemoteSkillCatalog, { status: "enumerated" }>;
    receivedAtMs: number;
  }): McpRemoteSkillCatalogCacheMetadata {
    return {
      server: args.entry.serverName,
      operation: "skills/list",
      source: args.source,
      reason: args.reason,
      ttlMs: args.catalog.cache.ttlMs,
      cacheScope: args.catalog.cache.cacheScope,
      receivedAt: new Date(args.receivedAtMs).toISOString(),
      expiresAt: args.catalog.cache.ttlMs > 0
        ? new Date(args.receivedAtMs + args.catalog.cache.ttlMs).toISOString()
        : null,
    };
  }

  private listOperationPrefix(serverName: string, operation: McpCachedListOperationKind): string {
    return `${serverName}\u0000${operation}\u0000`;
  }

  private listKey(
    entry: McpOperationEntry,
    operation: McpCachedListOperationKind,
    cursor: string | undefined,
  ): string {
    return `${this.listOperationPrefix(entry.serverName, operation)}` +
      `${entry.client.getCacheAuthorizationContextKey()}\u0000${cursor ?? ""}`;
  }

  private skillPrefix(serverName: string): string {
    return `${serverName}\u0000skills/list\u0000`;
  }

  private skillKey(entry: McpOperationEntry): string {
    return `${this.skillPrefix(entry.serverName)}${entry.client.getCacheAuthorizationContextKey()}`;
  }
}
