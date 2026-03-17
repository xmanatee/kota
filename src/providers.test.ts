import { afterEach, describe, expect, it } from "vitest";
import {
	getKnowledgeProvider,
	getMemoryProvider,
	getProviderRegistry,
	initProviderRegistry,
	type KnowledgeProvider,
	type MemoryProvider,
	ProviderRegistry,
	registerDefaultProviders,
	resetProviderRegistry,
} from "./providers.js";

// --- ProviderRegistry unit tests ---

describe("ProviderRegistry", () => {
	it("register and get a provider", () => {
		const reg = new ProviderRegistry();
		const provider = { name: "test" };
		reg.register("memory", "test", provider);
		expect(reg.get("memory")).toBe(provider);
	});

	it("first registered becomes active by default", () => {
		const reg = new ProviderRegistry();
		const first = { id: 1 };
		const second = { id: 2 };
		reg.register("memory", "first", first);
		reg.register("memory", "second", second);
		expect(reg.get("memory")).toBe(first);
		expect(reg.getActiveName("memory")).toBe("first");
	});

	it("setActive switches the active provider", () => {
		const reg = new ProviderRegistry();
		const a = { id: "a" };
		const b = { id: "b" };
		reg.register("svc", "a", a);
		reg.register("svc", "b", b);
		expect(reg.get("svc")).toBe(a);

		const ok = reg.setActive("svc", "b");
		expect(ok).toBe(true);
		expect(reg.get("svc")).toBe(b);
	});

	it("setActive returns false for unregistered provider", () => {
		const reg = new ProviderRegistry();
		reg.register("svc", "a", {});
		expect(reg.setActive("svc", "nope")).toBe(false);
	});

	it("setActive returns false for unregistered type", () => {
		const reg = new ProviderRegistry();
		expect(reg.setActive("nope", "a")).toBe(false);
	});

	it("getByName retrieves a specific named provider", () => {
		const reg = new ProviderRegistry();
		const a = { id: "a" };
		const b = { id: "b" };
		reg.register("svc", "a", a);
		reg.register("svc", "b", b);
		expect(reg.getByName("svc", "a")).toBe(a);
		expect(reg.getByName("svc", "b")).toBe(b);
		expect(reg.getByName("svc", "c")).toBeNull();
	});

	it("list returns provider names for a type", () => {
		const reg = new ProviderRegistry();
		reg.register("svc", "alpha", {});
		reg.register("svc", "beta", {});
		expect(reg.list("svc")).toEqual(["alpha", "beta"]);
		expect(reg.list("unknown")).toEqual([]);
	});

	it("listTypes returns all registered service types", () => {
		const reg = new ProviderRegistry();
		reg.register("memory", "default", {});
		reg.register("knowledge", "default", {});
		expect(reg.listTypes().sort()).toEqual(["knowledge", "memory"]);
	});

	it("register replaces an existing provider with the same name", () => {
		const reg = new ProviderRegistry();
		const v1 = { version: 1 };
		const v2 = { version: 2 };
		reg.register("svc", "impl", v1);
		expect(reg.get("svc")).toBe(v1);

		reg.register("svc", "impl", v2);
		expect(reg.get("svc")).toBe(v2);
		expect(reg.list("svc")).toEqual(["impl"]);
	});

	it("get returns null for unregistered type", () => {
		const reg = new ProviderRegistry();
		expect(reg.get("unknown")).toBeNull();
	});

	it("clear removes all providers", () => {
		const reg = new ProviderRegistry();
		reg.register("memory", "a", {});
		reg.register("knowledge", "b", {});
		reg.clear();
		expect(reg.get("memory")).toBeNull();
		expect(reg.get("knowledge")).toBeNull();
		expect(reg.listTypes()).toEqual([]);
	});
});

// --- Singleton tests ---

describe("provider singleton", () => {
	afterEach(() => resetProviderRegistry());

	it("initProviderRegistry creates a registry", () => {
		expect(getProviderRegistry()).toBeNull();
		const reg = initProviderRegistry();
		expect(reg).toBeInstanceOf(ProviderRegistry);
		expect(getProviderRegistry()).toBe(reg);
	});

	it("resetProviderRegistry clears the registry", () => {
		initProviderRegistry();
		expect(getProviderRegistry()).not.toBeNull();
		resetProviderRegistry();
		expect(getProviderRegistry()).toBeNull();
	});
});

// --- Interface conformance tests ---

describe("interface conformance", () => {
	it("MemoryProvider interface matches MemoryStore shape", async () => {
		const { MemoryStore } = await import("./memory.js");
		const store = new MemoryStore("/tmp/test-provider-conformance");
		const provider: MemoryProvider = store;
		expect(typeof provider.save).toBe("function");
		expect(typeof provider.search).toBe("function");
		expect(typeof provider.list).toBe("function");
		expect(typeof provider.update).toBe("function");
		expect(typeof provider.delete).toBe("function");
	});

	it("KnowledgeProvider interface matches KnowledgeStore shape", async () => {
		const { KnowledgeStore } = await import("./knowledge-store.js");
		const store = new KnowledgeStore("/tmp/test-provider-conformance");
		const provider: KnowledgeProvider = store;
		expect(typeof provider.create).toBe("function");
		expect(typeof provider.read).toBe("function");
		expect(typeof provider.update).toBe("function");
		expect(typeof provider.delete).toBe("function");
		expect(typeof provider.search).toBe("function");
		expect(typeof provider.list).toBe("function");
		expect(typeof provider.count).toBe("function");
	});
});

// --- Convenience getter tests ---

describe("convenience getters", () => {
	afterEach(() => resetProviderRegistry());

	it("getMemoryProvider falls back to MemoryStore when no registry", () => {
		resetProviderRegistry();
		const provider = getMemoryProvider();
		expect(typeof provider.save).toBe("function");
		expect(typeof provider.search).toBe("function");
	});

	it("getKnowledgeProvider falls back to KnowledgeStore when no registry", () => {
		resetProviderRegistry();
		const provider = getKnowledgeProvider("/tmp");
		expect(typeof provider.create).toBe("function");
		expect(typeof provider.search).toBe("function");
	});

	it("getMemoryProvider returns custom provider when registered", () => {
		const reg = initProviderRegistry();
		const custom: MemoryProvider = {
			save: () => "custom-id",
			search: () => [],
			list: () => [],
			update: () => true,
			delete: () => true,
		};
		reg.register("memory", "custom", custom);
		reg.setActive("memory", "custom");

		const provider = getMemoryProvider();
		expect(provider).toBe(custom);
		expect(provider.save("test")).toBe("custom-id");
	});

	it("getKnowledgeProvider returns custom provider when registered", () => {
		const reg = initProviderRegistry();
		const custom: KnowledgeProvider = {
			create: () => "custom-id",
			read: () => null,
			update: () => true,
			delete: () => true,
			search: () => [],
			list: () => [],
			count: () => 42,
		};
		reg.register("knowledge", "custom", custom);
		reg.setActive("knowledge", "custom");

		const provider = getKnowledgeProvider();
		expect(provider).toBe(custom);
		expect(provider.count()).toBe(42);
	});

	it("getMemoryProvider returns default when registry exists but has no memory provider", () => {
		initProviderRegistry();
		// Registry exists but no "memory" provider registered
		const provider = getMemoryProvider();
		expect(typeof provider.save).toBe("function");
	});
});

// --- registerDefaultProviders tests ---

describe("registerDefaultProviders", () => {
	afterEach(() => resetProviderRegistry());

	it("registers default memory and knowledge providers", () => {
		const reg = initProviderRegistry();
		registerDefaultProviders("/tmp");
		expect(reg.list("memory")).toEqual(["default"]);
		expect(reg.list("knowledge")).toEqual(["default"]);
		expect(reg.getActiveName("memory")).toBe("default");
		expect(reg.getActiveName("knowledge")).toBe("default");
	});

	it("default providers are functional", () => {
		initProviderRegistry();
		registerDefaultProviders("/tmp");
		const mem = getMemoryProvider();
		expect(typeof mem.save).toBe("function");
		const know = getKnowledgeProvider();
		expect(typeof know.create).toBe("function");
	});

	it("does nothing when registry not initialized", () => {
		resetProviderRegistry();
		// Should not throw
		registerDefaultProviders();
	});

	it("custom provider overrides default when setActive", () => {
		const reg = initProviderRegistry();
		registerDefaultProviders("/tmp");

		const custom: MemoryProvider = {
			save: () => "from-custom",
			search: () => [],
			list: () => [],
			update: () => true,
			delete: () => true,
		};
		reg.register("memory", "my-module", custom);
		reg.setActive("memory", "my-module");

		expect(getMemoryProvider()).toBe(custom);
	});
});
