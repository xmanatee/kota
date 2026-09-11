import { afterEach, expect, it } from "vitest";
import { getTaskStore, resetTaskStore } from "#core/daemon/task-store.js";
import {
  getHistoryProvider, getKnowledgeProvider, getMemoryProvider, getProviderRegistry,
  getTaskCollection, getTaskProviderRegistration, HISTORY_PROVIDER_TOKEN,
  initProviderRegistry, KNOWLEDGE_PROVIDER_TOKEN, MEMORY_PROVIDER_TOKEN,
  ProviderRegistry, registerDefaultProviders, resetProviderRegistry,
  TASK_PROVIDER_TOKEN, TaskCollection,
} from "./provider-registry.js";
import { defineProviderToken } from "./provider-token.js";

const token = defineProviderToken<{ id: string }>("service");
const otherToken = defineProviderToken<{ id: string }>("other");
afterEach(() => { resetProviderRegistry(); resetTaskStore(); });

it("selects, replaces, and enumerates providers without changing other token selections", () => {
  const registry = new ProviderRegistry();
  const first = { id: "first" };
  const second = { id: "second" };
  const replacement = { id: "replacement" };
  registry.register(token, "first", first);
  registry.register(token, "second", second);
  registry.register(otherToken, "first", replacement);
  expect(registry.get(token)).toBe(first);
  expect(registry.getActiveName(token)).toBe("first");
  expect(registry.getByName(token, "second")).toBe(second);
  expect(registry.list(token)).toEqual(["first", "second"]);
  expect(registry.listTokenIds()).toEqual([token, otherToken]);

  expect(registry.setActive(token, "second")).toBe(true);
  expect(registry.get(token)).toBe(second);
  expect(registry.get(otherToken)).toBe(replacement);
  registry.register(token, "second", replacement);
  expect(registry.get(token)).toBe(replacement);
  expect(registry.list(token)).toEqual(["first", "second"]);
  expect(registry.setActive(token, "missing")).toBe(false);
  expect(registry.get(token)).toBe(replacement);
  expect(registry.getByName(token, "missing")).toBeNull();
});

it("clears contributions and active selections so an empty registry can be reused", () => {
  const registry = new ProviderRegistry();
  registry.register(token, "old", { id: "old" });
  registry.register(otherToken, "other", { id: "other" });
  registry.clear();
  expect(registry.get(token)).toBeNull();
  expect(registry.get(otherToken)).toBeNull();
  expect(registry.getActiveName(token)).toBeNull();
  expect(registry.getByName(token, "old")).toBeNull();
  expect(registry.list(token)).toEqual([]);
  expect(registry.listTokenIds()).toEqual([]);
  expect(registry.setActive(token, "old")).toBe(false);
  const fresh = { id: "fresh" };
  registry.register(token, "new", fresh);
  expect(registry.get(token)).toBe(fresh);
});

it("owns the CLI process registry between initialization and reset", () => {
  expect(getProviderRegistry()).toBeNull();
  const registry = initProviderRegistry();
  expect(getProviderRegistry()).toBe(registry);
  resetProviderRegistry();
  expect(getProviderRegistry()).toBeNull();
  expect(() => registerDefaultProviders()).not.toThrow();
  expect(getProviderRegistry()).toBeNull();
});

it.each([
  ["memory", getMemoryProvider],
  ["knowledge", getKnowledgeProvider],
  ["history", getHistoryProvider],
] as const)("requires a loaded %s provider with either an absent or empty registry", (name, get) => {
  expect(() => get()).toThrow(`No ${name} provider registered`);
  initProviderRegistry();
  expect(() => get()).toThrow(`No ${name} provider registered`);
});

it("resolves module providers by identity without constructing defaults", () => {
  const registry = initProviderRegistry();
  const memory = {
    save: () => "id", search: () => [], list: () => [], update: () => true, delete: () => true,
  };
  const knowledge = {
    create: () => "id", read: () => null, update: () => true, delete: () => true,
    search: () => [], list: () => [], count: () => 0,
  };
  const history = {
    create: () => "id", save: () => {}, load: () => null, list: () => [],
    getMostRecent: () => null, findByPrefix: () => null, remove: () => false, cleanup: () => 0,
  };
  registry.register(MEMORY_PROVIDER_TOKEN, "custom", memory);
  registry.register(KNOWLEDGE_PROVIDER_TOKEN, "custom", knowledge);
  registry.register(HISTORY_PROVIDER_TOKEN, "custom", history);
  expect(getMemoryProvider()).toBe(memory);
  expect(getKnowledgeProvider()).toBe(knowledge);
  expect(getHistoryProvider()).toBe(history);
});

it("resolves default task collections from the store and preserves custom collection capabilities", async () => {
  const collection = getTaskStore().collection;
  expect(getTaskCollection()).toBe(collection);
  const registry = initProviderRegistry();
  expect(getTaskCollection()).toBe(collection);
  registerDefaultProviders();
  expect(registry.get(TASK_PROVIDER_TOKEN)?.collection).toBe(collection);
  expect(getTaskCollection()).toBe(collection);
  const defaults = getTaskProviderRegistration();
  const task = await defaults.mutations!.add("provider wiring", { notes: "forwarded" });
  expect(collection.get(task.id)).toMatchObject({ task: "provider wiring", notes: "forwarded" });
  await defaults.mutations!.update(task.id, { status: "done" });
  expect(collection.get(task.id)?.status).toBe("done");
  expect(await defaults.maintenance!.archiveCompleted()).toBe(1);
  expect(collection.get(task.id)).toBeUndefined();
  await defaults.mutations!.add("clear through provider");
  await defaults.maintenance!.clear();
  expect(collection.count()).toBe(0);
  const custom = { collection: new TaskCollection() };
  registry.register(TASK_PROVIDER_TOKEN, "custom", custom);
  expect(registry.setActive(TASK_PROVIDER_TOKEN, "custom")).toBe(true);
  expect(getTaskProviderRegistration()).toBe(custom);
  expect(getTaskCollection()).toBe(custom.collection);
  expect(getTaskProviderRegistration().mutations).toBeUndefined();
  expect(getTaskProviderRegistration().maintenance).toBeUndefined();
  registerDefaultProviders();
  expect(registry.getByName(TASK_PROVIDER_TOKEN, "default")?.collection).toBe(collection);
  expect(getTaskProviderRegistration()).toBe(custom);
});
