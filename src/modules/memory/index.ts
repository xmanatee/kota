/**
 * Memory module — persistent memory across sessions.
 *
 * Owns the file-based MemoryStore implementation and registers it as the
 * `default` memory provider. Contributes the `memory` tool in the `management`
 * group, the `kota memory` operator CLI commands, and the `/api/memory` HTTP
 * routes.
 *
 * Storage: `.kota/memory.json` (project) and `~/.kota/memory.json` (global).
 */


import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
  getMemoryProvider,
  MEMORY_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { readOnlyDaemonEffect } from "#core/tools/effect.js";
import { createMemoryReadinessSource } from "./capability-readiness.js";
import { registerMemoryCommands } from "./cli.js";
import type {
  MemoryAddResult,
  MemoryClient,
  MemoryDeleteResult,
  MemoryListResult,
  MemoryReindexResult,
  MemorySearchResult,
} from "./client.js";
import { memoryTool, runMemory } from "./memory.js";
import {
  createMemoryProjectStores,
  type MemoryProjectStores,
} from "./project-scope.js";
import { memoryRoutes } from "./routes.js";
import { getProjectMemoryStore } from "./store.js";

const memoryModule: KotaModule = {
  name: "memory",
  version: "1.0.0",
  description: "Persistent memory across sessions (save/search/list/update/delete)",
  dependencies: ["rendering"],
  tools: [
    {
      tool: memoryTool,
      runner: runMemory,
      effect: readOnlyDaemonEffect(),
      group: "management",
    },
  ],
  skills: [{ name: "memory", promptPath: "src/modules/memory/memory.md" }],

  localClient: (ctx) => {
    const projectStores = createMemoryProjectStores(ctx.cwd, () =>
      getMemoryProvider(),
    );
    const handler: MemoryClient = {
      async list(filter) {
        const provider = resolveMemoryProvider(projectStores, filter?.projectId);
        const all = provider.list();
        const slice =
          filter?.limit !== undefined ? all.slice(0, filter.limit) : all;
        return {
          entries: slice.map((entry) => ({
            id: entry.id,
            created: entry.created,
            content: entry.content,
          })),
        };
      },
      async add(content, tags, project) {
        const provider = resolveMemoryProvider(projectStores, project?.projectId);
        const id = provider.save(content, tags ?? []);
        return { id };
      },
      async delete(id, project) {
        const provider = resolveMemoryProvider(projectStores, project?.projectId);
        const ok = provider.delete(id);
        return ok ? { ok: true } : { ok: false, reason: "not_found" };
      },
      async search(query, filter) {
        const provider = resolveMemoryProvider(projectStores, filter?.projectId);
        const limit = filter?.limit ?? 20;
        if (filter?.semantic) {
          if (!provider.supportsSemanticSearch()) {
            return { ok: false, reason: "semantic_unavailable" };
          }
          const results = await provider.semanticSearch(query, limit, {
            tag: filter.tag,
            since: filter.since,
          });
          return {
            ok: true,
            entries: results.map((m) => ({ id: m.id, created: m.created, content: m.content })),
          };
        }
        const results = provider
          .search(query, { tag: filter?.tag, since: filter?.since })
          .slice(0, limit);
        return {
          ok: true,
          entries: results.map((m) => ({ id: m.id, created: m.created, content: m.content })),
        };
      },
      async reindex(project) {
        const provider = resolveMemoryProvider(projectStores, project?.projectId);
        return provider.reindex();
      },
    };
    return { memory: handler };
  },

  daemonClient: (link) => ({ memory: buildMemoryDaemonHandler(link) }),

  onLoad: (ctx: ModuleRuntimeContext) => {
    const store = getProjectMemoryStore(ctx.cwd);
    ctx.registerProvider(MEMORY_PROVIDER_TOKEN, store);
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createMemoryReadinessSource(store),
    );
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerMemoryCommands(root, ctx);
    return root.commands as Command[];
  },

  routes: (ctx) =>
    memoryRoutes(createMemoryProjectStores(ctx.cwd, () => getMemoryProvider())),
};

/**
 * Daemon-side `MemoryClient` backed by the typed `DaemonTransport`. Calls
 * the same `/api/memory` and `/api/memory/:id` HTTP routes the memory
 * module registers through `memoryRoutes`. The transport surface owns the
 * bearer token, base URL, and timeout policy — this factory only encodes
 * the wire shape.
 *
 * `list(filter)` issues `GET /api/memory` through `requestStrict<T>`, then
 * collapses the daemon-wire `{ id, tags, created, excerpt }[]` entries
 * into the `MemoryListResult` shape by mapping `excerpt → content`,
 * dropping `tags`, and slicing by `filter.limit ?? Number.POSITIVE_INFINITY`.
 *
 * Project-scoped calls append `?projectId=...`; omitted ids resolve at the
 * daemon route boundary. `add(content, tags)` issues `POST /api/memory`
 * with body `{ content, tags: tags ?? [] }` through `requestStrict<T>` and
 * returns `{ id }`.
 *
 * `delete(id)` issues `DELETE /api/memory/:id` through `fetchRaw`,
 * collapsing a 404 not-found response into `{ ok: false,
 * reason: "not_found" }`, preserving typed unknown-project errors, and
 * collapsing a non-null result into `{ ok: true }`.
 * The id runs through `encodeURIComponent` so embedded slashes,
 * percents, or spaces round-trip safely.
 *
 * `search(query, filter)` builds the same `URLSearchParams` shape the
 * pre-migration `searchMemoryHttp` built (`q`, optional `tag`, `since`,
 * `semantic=true`, `limit`) and issues `GET /api/memory/search?...`
 * through `requestStrict<T>`. The daemon route emits the discriminated
 * union directly; no additional collapse is needed.
 *
 * `reindex()` issues `POST /api/memory/reindex` through `requestStrict<T>`
 * and returns the provider's `ReindexResult` verbatim.
 */
function buildMemoryDaemonHandler(link: DaemonTransport): MemoryClient {
  return {
    list: async (filter): Promise<MemoryListResult> => {
      const query = projectQuery(filter?.projectId);
      const result = await link.requestStrict<{
        entries: { id: string; tags: string[]; created: string; excerpt: string }[];
      }>("GET", `/api/memory${query}`);
      const slice = result.entries.slice(
        0,
        filter?.limit ?? Number.POSITIVE_INFINITY,
      );
      return {
        entries: slice.map((entry) => ({
          id: entry.id,
          created: entry.created,
          content: entry.excerpt,
        })),
      };
    },
    add: async (content, tags, project): Promise<MemoryAddResult> => {
      const query = projectQuery(project?.projectId);
      const result = await link.requestStrict<{ id: string }>(
        "POST",
        `/api/memory${query}`,
        { content, tags: tags ?? [] },
      );
      return { id: result.id };
    },
    delete: async (id, project): Promise<MemoryDeleteResult> => {
      const query = projectQuery(project?.projectId);
      const result = await requestNullableMemoryRoute<{ deleted: string }>(
        link,
        "DELETE",
        `/api/memory/${encodeURIComponent(id)}${query}`,
      );
      return result ? { ok: true } : { ok: false, reason: "not_found" };
    },
    search: async (query, filter): Promise<MemorySearchResult> => {
      const params = new URLSearchParams();
      params.set("q", query);
      if (filter?.tag) params.set("tag", filter.tag);
      if (filter?.since) params.set("since", filter.since);
      if (filter?.semantic) params.set("semantic", "true");
      if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
      if (filter?.projectId) params.set("projectId", filter.projectId);
      return link.requestStrict<MemorySearchResult>(
        "GET",
        `/api/memory/search?${params.toString()}`,
      );
    },
    reindex: async (project): Promise<MemoryReindexResult> => {
      const query = projectQuery(project?.projectId);
      return link.requestStrict<MemoryReindexResult>(
        "POST",
        `/api/memory/reindex${query}`,
      );
    },
  };
}

type MemoryRouteErrorBody = {
  error?: string;
  reason?: string;
  projectId?: string;
};

async function requestNullableMemoryRoute<T>(
  link: DaemonTransport,
  method: string,
  path: string,
): Promise<T | null> {
  const res = await link.fetchRaw(path, { method });
  if (res.status === 404) {
    const body = await readMemoryRouteError(res);
    if (body?.reason === "unknown_project" && body.projectId) {
      throw new Error(`Unknown project: ${body.projectId}`);
    }
    return null;
  }
  if (!res.ok) {
    const body = await readMemoryRouteError(res);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return (await res.json()) as T;
}

async function readMemoryRouteError(
  res: Response,
): Promise<MemoryRouteErrorBody | null> {
  try {
    const parsed = (await res.json()) as MemoryRouteErrorBody;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function resolveMemoryProvider(
  projectStores: MemoryProjectStores,
  projectId: string | undefined,
) {
  const resolved = projectStores.resolve(projectId);
  if (!resolved.ok) {
    throw new Error(`Unknown project: ${resolved.error.projectId}`);
  }
  return resolved.store;
}

function projectQuery(projectId: string | undefined): string {
  if (!projectId) return "";
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  return `?${params.toString()}`;
}

export default memoryModule;
