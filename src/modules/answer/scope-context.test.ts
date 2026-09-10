import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { buildDirectoryScope, ScopeRegistry } from "#core/daemon/scope-registry.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { initProviderRegistry, ProviderRegistry, resetProviderRegistry } from "#core/modules/provider-registry.js";
import { answerHistoryRootForScope, DiskAnswerHistoryStore } from "./answer-history-store.js";
import { AnswerProviderImpl } from "./answer-provider.js";
import { ANSWER_PROVIDER_TOKEN } from "./answer-types.js";
import answerModule from "./index.js";
import { createAnswerScopeContextResolver } from "./scope-context.js";

describe("answer client history isolation", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kota-answer-scope-stores-")); });
  afterEach(() => { resetProviderRegistry(); rmSync(root, { recursive: true, force: true }); });

  function scope(name: string) {
    const scopeRoot = join(root, name);
    mkdirSync(scopeRoot);
    return buildDirectoryScope({ scopeRoot });
  }
  function history(scopeRoot: string) {
    return new DiskAnswerHistoryStore({ rootDir: answerHistoryRootForScope(join(scopeRoot, ".kota")) });
  }
  function client(scopeRoot: string, providers: ProviderRegistry) {
    const initialHistory = history(scopeRoot);
    const context = { cwd: scopeRoot, getProvider: providers.get.bind(providers) };
    providers.register(ANSWER_PROVIDER_TOKEN, "answer", new AnswerProviderImpl({
      history: initialHistory,
      resolveScopeContext: createAnswerScopeContextResolver(scopeRoot, () => initialHistory, context),
      recall: { async recall() { return { ok: true, hits: [] }; } },
      synthesizer: async () => { throw new Error("No-hit answers must not synthesize"); },
    }));
    return answerModule.localClient!(context as ModuleContext).answer!;
  }

  it("writes and reads each selected disk history after default and active scope changes", async () => {
    const a = scope("a");
    const b = scope("b");
    const scopes = new ScopeRegistry({ stateDir: join(root, "state"), scopes: [a] });
    let active: string | null = null;
    const providers = new ProviderRegistry();
    providers.register(DAEMON_SCOPE_PROVIDER_TYPE, "host", {
      getScopeRegistryProjection: () => scopes.toProjection(),
      getActiveScopeId: () => active,
      resolveScopeRuntime: () => { throw new Error("History selection does not require runtime services"); },
    });
    const answer = client(a.scopeRoot, providers);
    await answer.answer("original history");
    const original = (await answer.log()).entries[0];
    scopes.add(b);
    scopes.setDefault(b.scopeId);
    expect(await answer.log()).toEqual({ entries: [] });
    await answer.answer("later default history");
    expect((await answer.log()).entries.map(entry => entry.query)).toEqual(["later default history"]);
    expect(await answer.show(original.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await answer.show(original.id, { scopeId: a.scopeId })).toMatchObject({ ok: true, record: { query: "original history" } });
    active = a.scopeId;
    await answer.answer("active original history");
    expect((await history(a.scopeRoot).listAnswers()).map(entry => entry.query).sort()).toEqual(["active original history", "original history"]);
    expect((await history(b.scopeRoot).listAnswers()).map(entry => entry.query)).toEqual(["later default history"]);
    for (const action of [() => answer.answer("must not persist", { scopeId: "missing" }), () => answer.log({ scopeId: "missing" }), () => answer.show(original.id, { scopeId: "missing" })]) {
      await expect(action()).rejects.toThrow("Unknown scope");
    }
    expect(await history(a.scopeRoot).listAnswers()).toHaveLength(2);
    expect(await history(b.scopeRoot).listAnswers()).toHaveLength(1);
  });

  it("keeps a supplied host's absent provider from exposing or writing ambient history", async () => {
    const a = scope("a");
    const b = scope("b");
    const scopes = new ScopeRegistry({ stateDir: join(root, "state"), scopes: [b] });
    initProviderRegistry().register(DAEMON_SCOPE_PROVIDER_TYPE, "other-host", {
      getScopeRegistryProjection: () => scopes.toProjection(),
      getActiveScopeId: () => null,
      resolveScopeRuntime: () => { throw new Error("Unexpected runtime lookup"); },
    });
    const answer = client(a.scopeRoot, new ProviderRegistry());
    await answer.answer("isolated history");
    expect((await history(a.scopeRoot).listAnswers()).map(entry => entry.query)).toEqual(["isolated history"]);
    expect(await history(b.scopeRoot).listAnswers()).toEqual([]);
    await expect(answer.answer("must not persist", { scopeId: b.scopeId })).rejects.toThrow("Unknown scope");
    await expect(answer.log({ scopeId: b.scopeId })).rejects.toThrow("Unknown scope");
  });
});
