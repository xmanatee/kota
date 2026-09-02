import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import { MEMORY_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { readOnlyDaemonEffect } from "#core/tools/effect.js";
import { createMemoryDaemonClient } from "#root/client/kota-client.generated.js";
import { createMemoryReadinessSource } from "./capability-readiness.js";
import { registerMemoryCommands } from "./cli.js";
import type {
  MemoryClient,
} from "./client.js";
import { memoryTool, runMemory } from "./memory.js";
import {
  deleteMemory,
  listMemory,
  reindexMemory,
  searchMemory,
} from "./operations.js";
import { memoryRoutes } from "./routes.js";
import {
  createMemoryScopeStores,
  type MemoryScopeStores,
} from "./scope.js";
import { getScopeMemoryStore } from "./store.js";
import { memoryUiSurfaceSource } from "./ui-surface.js";

const memoryModule: KotaModule = {
  name: "memory",
  version: "1.0.0",
  description: "Persistent memory across sessions (save/search/list/update/delete)",
  dependencies: ["rendering"],
  uiSurfaces: [memoryUiSurfaceSource],
  tools: (ctx) => [
    {
      tool: memoryTool,
      runner: (input) => {
        const provider = ctx.getProvider(MEMORY_PROVIDER_TOKEN);
        if (!provider) throw new Error("memory provider is not registered");
        return runMemory(input, provider);
      },
      effect: readOnlyDaemonEffect(),
      group: "management",
    },
  ],
  skills: [{ name: "memory", promptPath: "src/modules/memory/memory.md" }],

  localClient: (ctx) => {
    const scopeStores = createMemoryScopeStores(ctx.cwd, () => {
      const provider = ctx.getProvider(MEMORY_PROVIDER_TOKEN);
      if (!provider) throw new Error("memory provider is not registered");
      return provider;
    }, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE));
    const handler: MemoryClient = {
      async list(filter) {
        const provider = resolveMemoryProvider(scopeStores, filter?.scopeId);
        return listMemory(provider, filter);
      },
      async add(content, tags, scopeSelector) {
        const provider = resolveMemoryProvider(scopeStores, scopeSelector?.scopeId);
        const id = provider.save(content, tags ?? []);
        return { id };
      },
      async delete(id, scopeSelector) {
        const provider = resolveMemoryProvider(scopeStores, scopeSelector?.scopeId);
        return deleteMemory(provider, id);
      },
      async search(query, filter) {
        const provider = resolveMemoryProvider(scopeStores, filter?.scopeId);
        return searchMemory(provider, query, filter);
      },
      async reindex(scopeSelector) {
        const provider = resolveMemoryProvider(scopeStores, scopeSelector?.scopeId);
        return reindexMemory(provider);
      },
    };
    return { memory: handler };
  },

  daemonClient: (link) => ({ memory: buildMemoryDaemonHandler(link) }),

  onLoad: (ctx: ModuleRuntimeContext) => {
    const store = getScopeMemoryStore(ctx.cwd);
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
    memoryRoutes(createMemoryScopeStores(ctx.cwd, () => {
      const provider = ctx.getProvider(MEMORY_PROVIDER_TOKEN);
      if (!provider) throw new Error("memory provider is not registered");
      return provider;
    }, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE))),
};

function buildMemoryDaemonHandler(link: DaemonTransport): MemoryClient {
  return createMemoryDaemonClient(link, {
    delete: async (id, scopeSelector) => {
      const query = scopeQuery(scopeSelector?.scopeId);
      const result = await requestNullableMemoryRoute<{ deleted: string }>(
        link,
        "DELETE",
        `/api/memory/${encodeURIComponent(id)}${query}`,
      );
      return result ? { ok: true } : { ok: false, reason: "not_found" };
    },
  });
}

type MemoryRouteErrorBody = {
  error?: string;
  reason?: string;
  scopeId?: string;
};

async function requestNullableMemoryRoute<T>(
  link: DaemonTransport,
  method: string,
  path: string,
): Promise<T | null> {
  const res = await link.fetchRaw(path, { method });
  if (res.status === 404) {
    const body = await readMemoryRouteError(res);
    if (body?.reason === "unknown_scope" && body.scopeId) {
      throw new Error(`Unknown scope: ${body.scopeId}`);
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
  scopeStores: MemoryScopeStores,
  scopeId: string | undefined,
) {
  const resolved = scopeStores.resolve(scopeId);
  if (!resolved.ok) {
    throw new Error(`Unknown scope: ${resolved.error.scopeId}`);
  }
  return resolved.store;
}

function scopeQuery(scopeId: string | undefined): string {
  if (!scopeId) return "";
  const params = new URLSearchParams();
  params.set("scopeId", scopeId);
  return `?${params.toString()}`;
}

export default memoryModule;
