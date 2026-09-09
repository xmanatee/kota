import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { buildDirectoryScope, ScopeRegistry } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { ProviderRegistry } from "#core/modules/provider-registry.js";
import { findRouteMatch } from "#core/modules/route-matcher.js";
import { clearCustomTools } from "#core/tools/index.js";
import { getScopeHistoryStore } from "#modules/history/history.js";
import historyModule from "#modules/history/index.js";
import knowledgeModule from "#modules/knowledge/index.js";
import memoryModule from "#modules/memory/index.js";
import renderingModule from "#modules/rendering/index.js";
import replModule from "#modules/repl/index.js";

// Real module factories + host registries + contributed HTTP handlers: catches stale factory captures
// and wrong-host/default-store binding that the pure selection contract cannot.
describe("module store scope composition", () => {
  const roots: string[] = [];
  const loaders: ModuleLoader[] = [];

  afterEach(async () => {
    for (const loader of loaders.splice(0).reverse()) await loader.unloadAll();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  async function host() {
    const root = mkdtempSync(join(tmpdir(), "kota-module-store-host-"));
    roots.push(root);
    const providers = new ProviderRegistry();
    const loader = new ModuleLoader({}, false, { providerRegistry: providers });
    loaders.push(loader);
    loader.setCwd(root);
    loader.setBus(new EventBus());
    for (const module of [renderingModule, replModule, memoryModule, historyModule, knowledgeModule]) {
      await loader.load(module);
    }
    const handlers = loader.getLocalClientHandlers();
    const client = { memory: handlers.memory!, history: handlers.history!, knowledge: handlers.knowledge! };
    const routes = [...loader.getRoutes(), ...loader.getContributedControlRoutes()];
    async function request(path: string) {
      const req = new IncomingMessage(new Socket());
      req.method = "GET";
      req.url = path;
      const res = new ServerResponse(req);
      let body: unknown;
      vi.spyOn(res, "end").mockImplementation((data: string | Uint8Array) => {
        body = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
        return res;
      });
      const match = findRouteMatch(routes, req.method, new URL(path, "http://localhost").pathname);
      if (!match) throw new Error(`Missing contributed route: ${path}`);
      await match.route.handler(req, res, match.params);
      return { status: res.statusCode, body };
    }
    return { root, providers, client, request };
  }

  it("keeps existing local and HTTP consumers live and isolated across scopes and hosts", async () => {
    const a = await host();
    // Tool registration is process-global; this journey exercises host-owned
    // client/route/provider state, so release that unrelated port between hosts.
    clearCustomTools();
    const b = await host();
    await a.client.memory.add("host A default");
    await b.client.memory.add("host B default");
    await a.client.knowledge.add({ title: "Host A", content: "default A", scope: "scope" });
    await b.client.knowledge.add({ title: "Host B", content: "default B", scope: "scope" });
    for (const current of [a, b]) getScopeHistoryStore(current.root).create("test-model", current.root);

    const registry = new ScopeRegistry({ stateDir: join(a.root, ".kota"), scopes: [{ scopeRoot: a.root }] });
    let active: string | null = null;
    // Register after every local client and route factory has already run.
    a.providers.register(DAEMON_SCOPE_PROVIDER_TYPE, "default", {
      getScopeRegistryProjection: () => registry.toProjection(),
      getActiveScopeId: () => active,
      resolveScopeRuntime: () => { throw new Error("Store selection does not resolve runtime services"); },
    });
    const selectedRoot = join(a.root, "selected");
    mkdirSync(selectedRoot);
    const selected = buildDirectoryScope({ scopeRoot: selectedRoot });
    registry.add(selected);
    active = selected.scopeId;
    await a.client.memory.add("selected memory");
    await a.client.knowledge.add({ title: "Selected", content: "selected knowledge", scope: "scope" });
    const historyId = getScopeHistoryStore(selectedRoot).create("selected-model", selectedRoot);

    expect((await a.client.memory.list()).entries.map((entry) => entry.content)).toEqual(["selected memory"]);
    expect((await a.client.knowledge.list({ scope: "scope" })).entries.map((entry) => entry.title)).toEqual(["Selected"]);
    expect((await a.client.history.list()).conversations.map((entry) => entry.id)).toEqual([historyId]);
    expect((await b.client.memory.list()).entries.map((entry) => entry.content)).toEqual(["host B default"]);
    expect((await b.client.knowledge.list({ scope: "scope" })).entries.map((entry) => entry.title)).toEqual(["Host B"]);
    expect((await b.client.history.list()).conversations.map((entry) => entry.cwd)).toEqual([b.root]);

    for (const namespace of ["memory", "knowledge", "history"] as const) {
      const path = `/api/${namespace}?scope=scope`;
      const response = await a.request(path);
      expect(response.status).toBe(200);
      const local = namespace === "knowledge" ? await a.client.knowledge.list({ scope: "scope" }) : await a.client[namespace].list();
      expect(response.body).toEqual(local);
      const rejected = await a.request(`${path}&scopeId=missing`);
      expect(rejected.status).toBe(404);
      expect(rejected.body).toEqual({ error: "Unknown scope", reason: "unknown_scope", scopeId: "missing" });
      await expect(a.client[namespace].list({ scopeId: "missing" })).rejects.toThrow("Unknown scope: missing");
      await expect(b.client[namespace].list({ scopeId: selected.scopeId })).rejects.toThrow("Unknown scope");
    }
    const control = await a.request("/history");
    expect(control.body).toEqual(await a.client.history.list());
    active = null;
    expect((await a.client.memory.list()).entries.map((entry) => entry.content)).toEqual(["host A default"]);
    expect((await a.client.knowledge.list({ scope: "scope" })).entries.map((entry) => entry.title)).toEqual(["Host A"]);
    expect((await a.client.history.list()).conversations.map((entry) => entry.cwd)).toEqual([a.root]);

    // Changing the selection default must not rebind the providers loaded for a.root.
    const originalScopeId = registry.toProjection().defaultScopeId;
    registry.setDefault(selected.scopeId);
    expect((await a.client.memory.list()).entries.map((entry) => entry.content)).toEqual(["selected memory"]);
    expect((await a.client.knowledge.list({ scope: "scope" })).entries.map((entry) => entry.title)).toEqual(["Selected"]);
    expect((await a.client.history.list()).conversations.map((entry) => entry.id)).toEqual([historyId]);
    await a.client.memory.add("new default memory");
    await a.client.knowledge.add({ title: "New default", content: "new default knowledge", scope: "scope" });
    expect(await a.client.history.delete(historyId)).toEqual({ ok: true });

    expect((await a.client.memory.list({ scopeId: selected.scopeId })).entries.map((entry) => entry.content))
      .toEqual(expect.arrayContaining(["selected memory", "new default memory"]));
    expect((await a.client.knowledge.list({ scope: "scope", scopeId: selected.scopeId })).entries.map((entry) => entry.title))
      .toEqual(expect.arrayContaining(["Selected", "New default"]));
    expect(getScopeHistoryStore(selectedRoot).list()).toEqual([]);
    expect((await a.client.memory.list({ scopeId: originalScopeId })).entries.map((entry) => entry.content)).toEqual(["host A default"]);
    expect((await a.client.knowledge.list({ scope: "scope", scopeId: originalScopeId })).entries.map((entry) => entry.title)).toEqual(["Host A"]);
    expect((await a.client.history.list({ scopeId: originalScopeId })).conversations.map((entry) => entry.cwd)).toEqual([a.root]);
    for (const namespace of ["memory", "knowledge", "history"] as const) {
      const local = namespace === "knowledge" ? await a.client.knowledge.list({ scope: "scope" }) : await a.client[namespace].list();
      expect(await a.request(`/api/${namespace}?scope=scope`)).toEqual({ status: 200, body: local });
    }
    expect((await a.request("/history")).body).toEqual(await a.client.history.list());
    expect((await b.client.memory.list()).entries.map((entry) => entry.content)).toEqual(["host B default"]);
    expect((await b.client.knowledge.list({ scope: "scope" })).entries.map((entry) => entry.title)).toEqual(["Host B"]);
    expect((await b.client.history.list()).conversations.map((entry) => entry.cwd)).toEqual([b.root]);
  });
});
