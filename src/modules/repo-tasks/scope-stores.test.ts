import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { buildDirectoryScope, ScopeRegistry } from "#core/daemon/scope-registry.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { initProviderRegistry, ProviderRegistry, REPO_TASKS_PROVIDER_TOKEN, resetProviderRegistry } from "#core/modules/provider-registry.js";
import { FakeEmbeddingProvider } from "#modules/semantic-index/test-support.js";
import { SemanticTasksStore, tasksSidecarDir } from "#modules/tasks-semantic/semantic-store.js";
import repoTasksModule from "./index.js";

describe("task client store isolation", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kota-task-scope-stores-")); });
  afterEach(() => { resetProviderRegistry(); rmSync(root, { recursive: true, force: true }); });

  function scope(name: string) {
    const scopeRoot = join(root, name);
    mkdirSync(join(scopeRoot, "data/tasks"), { recursive: true });
    writeFileSync(join(scopeRoot, `data/tasks/task-${name}.md`), `---\nstatus: open\npriority: p1\n---\n# Search ${name}\n`);
    return buildDirectoryScope({ scopeRoot });
  }

  it("keeps semantic search and reindex attached to the construction workspace after a default change", async () => {
    const a = scope("a");
    const b = scope("b");
    const scopes = new ScopeRegistry({ stateDir: join(root, "state"), scopes: [a] });
    let active: string | null = null;
    const providers = new ProviderRegistry();
    providers.register(DAEMON_SCOPE_PROVIDER_TYPE, "host", {
      getScopeRegistryProjection: () => scopes.toProjection(),
      getActiveScopeId: () => active,
      resolveScopeRuntime: () => { throw new Error("Store selection does not require runtime services"); },
    });
    const semantic = new SemanticTasksStore({ scopeRoot: a.scopeRoot, provider: new FakeEmbeddingProvider() });
    providers.register(REPO_TASKS_PROVIDER_TOKEN, "semantic", semantic);
    const client = repoTasksModule.localClient!({ cwd: a.scopeRoot, getProvider: providers.get.bind(providers) } as ModuleContext).tasks!;
    expect(await client.reindex()).toMatchObject({ ok: true, indexed: 1, failed: 0 });
    expect(await client.search("Search")).toMatchObject({ ok: true, tasks: [{ id: "task-a" }] });

    scopes.add(b);
    scopes.setDefault(b.scopeId);
    expect(await client.search("Search")).toEqual({ ok: false, reason: "semantic_unavailable" });
    expect(await client.reindex()).toEqual({ ok: false, reason: "semantic_unavailable" });
    expect(existsSync(tasksSidecarDir(b.scopeRoot))).toBe(false);
    expect(await client.search("Search", { semantic: false })).toMatchObject({ ok: true, tasks: [{ id: "task-b" }] });
    expect(await client.search("Search", { scopeId: a.scopeId })).toMatchObject({ ok: true, tasks: [{ id: "task-a" }] });
    expect(await client.reindex({ scopeId: a.scopeId })).toMatchObject({ ok: true, indexed: 1 });
    active = a.scopeId;
    expect(await client.search("Search")).toMatchObject({ ok: true, tasks: [{ id: "task-a" }] });
    await expect(client.search("Search", { scopeId: "missing" })).rejects.toThrow("Unknown scope: missing");
    await expect(client.reindex({ scopeId: "missing" })).rejects.toThrow("Unknown scope: missing");
    await semantic.flush();
  });

  it("does not read another host's task files when its supplied host has no scope provider", async () => {
    const a = scope("a");
    const b = scope("b");
    const scopes = new ScopeRegistry({ stateDir: join(root, "state"), scopes: [b] });
    initProviderRegistry().register(DAEMON_SCOPE_PROVIDER_TYPE, "other-host", {
      getScopeRegistryProjection: () => scopes.toProjection(),
      getActiveScopeId: () => null,
      resolveScopeRuntime: () => { throw new Error("Unexpected runtime lookup"); },
    });
    const providers = new ProviderRegistry();
    const client = repoTasksModule.localClient!({ cwd: a.scopeRoot, getProvider: providers.get.bind(providers) } as ModuleContext).tasks!;
    expect(await client.search("Search", { semantic: false })).toMatchObject({ ok: true, tasks: [{ id: "task-a" }] });
    await expect(client.search("Search", { scopeId: b.scopeId, semantic: false })).rejects.toThrow("Unknown scope");
  });
});
