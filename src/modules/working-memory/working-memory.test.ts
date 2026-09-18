import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { deriveDirectoryScopeId, ScopeRegistry } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { collectDynamicState } from "#core/loop/dynamic-state.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { ModuleStorage } from "#core/modules/module-storage.js";
import { executeTool, getToolEffect, type ToolRunnerContext } from "#core/tools/index.js";
import { registerSessionEnvironment, unregisterSessionEnvironment } from "#core/tools/session-environment.js";
import workingMemoryModule from "./index.js";

describe("working-memory tool and prompt lifecycle", () => {
  let root: string;
  let scopeRoot: string;
  let otherRoot: string;
  let loader: ModuleLoader;
  let storage: ModuleStorage;
  let a: ToolRunnerContext;
  let b: ToolRunnerContext;
  let other: ToolRunnerContext;
  const sessions: ToolRunnerContext[] = [];

  function session(sessionId: string, directory = scopeRoot): ToolRunnerContext {
    const execution = { sessionId, scopeId: deriveDirectoryScopeId(directory), scopeRoot: directory };
    registerSessionEnvironment(execution);
    sessions.push(execution);
    return execution;
  }
  const call = (input: Record<string, unknown>, execution = a) => executeTool("working_memory", input, execution);
  const prompt = (execution?: ToolRunnerContext, activeTools = new Set(["working_memory"])) =>
    collectDynamicState({ execution, activeTools });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "kota-working-memory-"));
    scopeRoot = join(root, "a");
    otherRoot = join(root, "b");
    mkdirSync(scopeRoot);
    mkdirSync(otherRoot);
    const registry = new ScopeRegistry({ stateDir: join(root, "state"), scopes: [{ scopeRoot }, { scopeRoot: otherRoot }] });
    loader = new ModuleLoader({}, false, { scopeRoot });
    loader.setCwd(scopeRoot);
    loader.setBus(new EventBus());
    loader.getProviderRegistry().register(DAEMON_SCOPE_PROVIDER_TYPE, "host", {
      getScopeRegistryProjection: () => registry.toProjection(),
      getActiveScopeId: () => deriveDirectoryScopeId(otherRoot),
      resolveScopeRuntime: () => { throw new Error("Selection does not resolve runtime services"); },
    });
    storage = new ModuleStorage(scopeRoot, "working-memory");
    await loader.load(workingMemoryModule);
    a = session("a");
    b = session("b");
    other = session("a", otherRoot);
  });

  afterEach(async () => {
    for (const execution of sessions.splice(0)) await unregisterSessionEnvironment(execution);
    await loader.unloadAll();
    rmSync(root, { recursive: true, force: true });
  });

  it("isolates same-key tools, prompts, clear, and teardown across sessions and scopes", async () => {
    await call({ action: "write", key: "plan", value: "alpha" });
    await call({ action: "write", key: "plan", value: "beta" }, b);
    expect((await call({ action: "read", key: "plan" })).content).toBe("plan: alpha");
    expect((await call({ action: "read", key: "plan" }, b)).content).toBe("plan: beta");
    expect((await call({ action: "list" }, other)).content).toContain("empty");
    expect(prompt(a)).toContain("alpha");
    expect(prompt(a)).not.toContain("beta");
    expect(prompt(other)).toBe("");
    await call({ action: "clear" });
    await unregisterSessionEnvironment(a);
    expect(prompt(b)).toContain("beta");
    expect(prompt(a)).toBe("");
    expect((await call({ action: "write", key: "stale", value: "no" })).is_error).toBe(true);
    expect(storage.has("entries")).toBe(false);
  });

  it("gates prompts before compaction and never falls back for absent or unavailable identities", async () => {
    for (let i = 0; i < 7; i++) await call({ action: "write", key: `${i}`, value: "x".repeat(460) });
    expect(prompt(a, new Set())).toBe("");
    expect((await call({ action: "read", key: "0" })).content).toContain("x".repeat(460));
    expect(prompt()).toBe("");
    expect((await executeTool("working_memory", { action: "list" })).is_error).toBe(true);
    const unavailable = { ...a, resolveRuntimeScope: (scopeId: string) => ({ ok: false as const, scopeId }) };
    expect(prompt(unavailable)).toBe("");
    expect((await call({ action: "list" }, unavailable)).is_error).toBe(true);
    expect(prompt({ ...a, scopeId: "unknown" })).toBe("");
    expect(prompt(a)).toContain("working-memory-compacted");
    expect(prompt(b)).toBe("");
    await loader.unload("working-memory");
    expect(prompt(a)).toBe("");
    expect((await call({ action: "list" })).is_error).toBe(true);
  });

  it("validates writes and handles the existing read/list/remove operations", async () => {
    for (const input of [{ action: "write", value: "v" }, { action: "write", key: "k" }, { action: "write", key: "k", value: "v", persist: "yes" }, { action: "invalid" }]) {
      expect((await call(input)).is_error).toBe(true);
    }
    expect((await call({ action: "write", key: "k", value: "" })).is_error).toBeUndefined();
    expect((await call({ action: "list" })).content).toContain("1 entries");
    expect((await call({ action: "remove", key: "k" })).content).toContain("Removed");
    expect((await call({ action: "read", key: "k" })).is_error).toBe(true);
  });

  it("normalizes prior array storage once and saves omitted-persist updates across reload", async () => {
    const entries = [{ key: "saved", value: "old", updatedAt: 1000 }];
    storage.setJSON("entries", entries);
    await loader.unload("working-memory");
    await loader.load(workingMemoryModule);
    expect(storage.getJSON("entries")).toEqual({ schemaVersion: 1, entries });
    const canonical = storage.readFile("entries.json");
    expect(prompt(a)).toContain("old");
    expect(storage.readFile("entries.json")).toBe(canonical);
    expect((await call({ action: "write", key: "saved", value: "updated" })).content).toContain("persistent");
    await unregisterSessionEnvironment(a);
    await loader.unload("working-memory");
    await loader.load(workingMemoryModule);
    expect((await call({ action: "read", key: "saved" }, session("restart"))).content).toBe("saved: updated [persistent]");
    expect(prompt(other)).toBe("");
    await call({ action: "write", key: "saved", value: "other scope", persist: true }, other);
    expect(storage.getJSON("entries")).toMatchObject({ entries: [{ value: "updated" }] });
    expect(new ModuleStorage(otherRoot, "working-memory").getJSON("entries")).toMatchObject({ entries: [{ value: "other scope" }] });
  });

  it("merges stale session mutations, demotes persistence locally, and clears only owned keys", async () => {
    await call({ action: "list" }, b);
    await call({ action: "write", key: "a", value: "first", persist: true });
    await call({ action: "write", key: "b", value: "keep", persist: true }, b);
    await call({ action: "write", key: "a", value: "latest" });
    expect(storage.getJSON("entries")).toMatchObject({ entries: expect.arrayContaining([{ key: "a", value: "latest", updatedAt: expect.any(Number) }, { key: "b", value: "keep", updatedAt: expect.any(Number) }]) });
    await call({ action: "write", key: "a", value: "local", persist: false });
    expect((await call({ action: "read", key: "a" })).content).toBe("a: local");
    expect(storage.getJSON("entries")).toMatchObject({ entries: [{ key: "b" }] });
    await call({ action: "write", key: "c", value: "clear me", persist: true });
    await call({ action: "clear" });
    expect(storage.getJSON("entries")).toMatchObject({ entries: [{ key: "b" }] });
    expect((await call({ action: "list" }, session("reload"))).content).toContain("b: keep [persistent]");
    await call({ action: "remove", key: "b" }, b);
    expect(storage.has("entries")).toBe(false);
  });

  it("preserves durable entries beyond the local prompt budget when a session saves", async () => {
    const entries = Array.from({ length: 21 }, (_, i) => ({ key: `k${i}`, value: "saved", updatedAt: i }));
    storage.setJSON("entries", { schemaVersion: 1, entries });
    await call({ action: "write", key: "k0", value: "updated" });
    expect(storage.getJSON("entries")).toMatchObject({ entries: expect.arrayContaining([entries[20]]) });
    expect((storage.getJSON("entries") as { entries: object[] }).entries).toHaveLength(21);
  });

  it("rejects corrupt persisted data on load and mutation without overwriting disk or local state", async () => {
    await call({ action: "write", key: "saved", value: "intact", persist: true });
    for (const corrupt of ["{broken", JSON.stringify([
      { key: "saved", value: "valid prefix", updatedAt: 1000 },
      { key: "bad", value: 1, updatedAt: 2000 },
    ])]) {
      storage.writeFile("entries.json", corrupt);
      expect((await call({ action: "write", key: "saved", value: "lost" })).is_error).toBe(true);
      expect((await call({ action: "read", key: "saved" })).content).toContain("intact");
      expect(storage.readFile("entries.json")).toBe(corrupt);
    }
    const corrupt = storage.readFile("entries.json");
    await loader.unload("working-memory");
    await expect(loader.load(workingMemoryModule)).rejects.toThrow("Working memory entry 1 is malformed");
    expect(storage.readFile("entries.json")).toBe(corrupt);
  });

  it("rejects unsupported schemas and malformed or ambiguous entries without rewriting them", async () => {
    await loader.unload("working-memory");
    for (const raw of [{ schemaVersion: 2, entries: [] }, { schemaVersion: 1, entries: [{ key: "x", value: 1, updatedAt: 1 }] }, { schemaVersion: 1, entries: [{ key: "x", value: "a", updatedAt: 1 }, { key: "x", value: "b", updatedAt: 2 }] }]) {
      storage.setJSON("entries", raw);
      await expect(loader.load(workingMemoryModule)).rejects.toThrow(/Working memory/);
      expect(storage.getJSON("entries")).toEqual(raw);
    }
  });

  it("declares potentially durable mutations as daemon-state and reads as session operations", () => {
    expect(getToolEffect("working_memory")).toMatchObject({ kind: "write", scope: "daemon-state" });
    expect(getToolEffect("working_memory", { action: "write" })).toMatchObject({ kind: "write", scope: "daemon-state" });
    expect(getToolEffect("working_memory", { action: "clear" })).toMatchObject({ kind: "write", scope: "daemon-state" });
    expect(getToolEffect("working_memory", { action: "read" })).toMatchObject({ kind: "read", scope: "session" });
  });
});
