import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProviderRegistry, resetProviderRegistry } from "#core/modules/provider-registry.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "./scope-provider.js";
import { buildDirectoryScope, ScopeRegistry } from "./scope-registry.js";
import { createDirectoryScopeSelector, type DirectoryScopeSelectionOptions } from "./scope-selection.js";

// Store consumers rely on invocation-time selection; this owner portfolio proves
// precedence and rejection independently of module storage and transport.
describe("directory scope selection", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kota-scope-selection-")); });
  afterEach(() => { resetProviderRegistry(); rmSync(root, { recursive: true, force: true }); });

  function scope(name: string) {
    const scopeRoot = join(root, name);
    mkdirSync(scopeRoot);
    return buildDirectoryScope({ scopeRoot });
  }

  it("selects explicit, active, then default scopes and rejects unknown selections", () => {
    const a = scope("a");
    const b = scope("b");
    let active: string | null = null;
    const select = createDirectoryScopeSelector({
      defaultScopeRoot: root,
      scopes: [a, b],
      getActiveScopeId: () => active,
      getDaemonScopeProvider: () => null,
    });
    expect(select(undefined)).toEqual({ ok: true, scope: a });
    active = b.scopeId;
    for (const omitted of [undefined, null, "", "   "]) {
      expect(select(omitted)).toEqual({ ok: true, scope: b });
    }
    expect(select(` ${a.scopeId} `)).toEqual({ ok: true, scope: a });
    expect(select("missing")).toEqual({
      ok: false, error: { error: "Unknown scope", reason: "unknown_scope", scopeId: "missing" },
    });
    active = "stale";
    expect(select(null)).toMatchObject({ ok: false, error: { scopeId: "stale" } });
    expect(select(a.scopeId)).toMatchObject({ ok: true, scope: a });
  });

  it("observes late provider registration, registry updates, and active/default changes", () => {
    const a = scope("a");
    const b = scope("b");
    const registry = new ScopeRegistry({ stateDir: join(root, "state"), scopes: [{ scopeRoot: a.scopeRoot }] });
    let active: string | null = null;
    let provider: ReturnType<NonNullable<DirectoryScopeSelectionOptions["getDaemonScopeProvider"]>> = null;
    const select = createDirectoryScopeSelector({ defaultScopeRoot: root, getDaemonScopeProvider: () => provider });
    expect(select(null)).toMatchObject({ ok: true, scope: buildDirectoryScope({ scopeRoot: root }) });
    provider = { getScopeRegistryProjection: () => registry.toProjection(), getActiveScopeId: () => active };
    expect(select(null)).toMatchObject({ ok: true, scope: a });
    registry.add(b);
    active = b.scopeId;
    expect(select(null)).toEqual({ ok: true, scope: b });
    registry.setDefault(b.scopeId);
    active = null;
    expect(select(null)).toEqual({ ok: true, scope: b });
    registry.remove(a.scopeId);
    for (const missing of [a.scopeId, "global"]) {
      expect(select(missing)).toMatchObject({ ok: false, error: { scopeId: missing } });
    }
  });

  it("uses the standalone provider registry only when no host lookup was supplied", () => {
    const a = scope("a");
    const registry = new ScopeRegistry({ stateDir: join(root, "state"), scopes: [{ scopeRoot: a.scopeRoot }] });
    const ambient = createDirectoryScopeSelector({ defaultScopeRoot: root });
    const bound = createDirectoryScopeSelector({ defaultScopeRoot: root, getDaemonScopeProvider: () => null });
    initProviderRegistry().register(DAEMON_SCOPE_PROVIDER_TYPE, "default", {
      getScopeRegistryProjection: () => registry.toProjection(),
      getActiveScopeId: () => null,
      resolveScopeRuntime: () => { throw new Error("Selection does not resolve runtime services"); },
    });
    expect(ambient(null)).toMatchObject({ ok: true, scope: a });
    expect(bound(null)).toMatchObject({ ok: true, scope: buildDirectoryScope({ scopeRoot: root }) });
    expect(bound(a.scopeId)).toMatchObject({ ok: false, error: { scopeId: a.scopeId } });
  });

  it("rejects invalid standalone registry inputs", () => {
    expect(() => createDirectoryScopeSelector({ defaultScopeRoot: root, scopes: [] })).toThrow(/at least one scope/);
    expect(() => createDirectoryScopeSelector({ defaultScopeRoot: root, defaultScopeId: "missing" })).toThrow(/not registered/);
  });
});
