import { afterEach, describe, expect, it } from "vitest";
import {
	getHistoryProvider,
	getKnowledgeProvider,
	getMemoryProvider,
	getProviderRegistry,
	getTaskProvider,
	HISTORY_PROVIDER_TOKEN,
	type HistoryProvider,
	initProviderRegistry,
	KNOWLEDGE_PROVIDER_TOKEN,
	type KnowledgeProvider,
	MEMORY_PROVIDER_TOKEN,
	type MemoryProvider,
	ProviderRegistry,
	registerDefaultProviders,
	resetProviderRegistry,
	TASK_PROVIDER_TOKEN,
	type TaskProvider,
} from "./provider-registry.js";
import { defineProviderToken } from "./provider-token.js";

const TEST_SVC_TOKEN = defineProviderToken<{ id: string }>("svc");
const TEST_UNKNOWN_TOKEN = defineProviderToken<unknown>("unknown");

// --- ProviderRegistry unit tests ---

describe("ProviderRegistry", () => {
	it("register and get a provider", () => {
		const reg = new ProviderRegistry();
		const provider: MemoryProvider = makeMemoryProvider();
		reg.register(MEMORY_PROVIDER_TOKEN, "test", provider);
		expect(reg.get(MEMORY_PROVIDER_TOKEN)).toBe(provider);
	});

	it("first registered becomes active by default", () => {
		const reg = new ProviderRegistry();
		const first = makeMemoryProvider();
		const second = makeMemoryProvider();
		reg.register(MEMORY_PROVIDER_TOKEN, "first", first);
		reg.register(MEMORY_PROVIDER_TOKEN, "second", second);
		expect(reg.get(MEMORY_PROVIDER_TOKEN)).toBe(first);
		expect(reg.getActiveName(MEMORY_PROVIDER_TOKEN)).toBe("first");
	});

	it("setActive switches the active provider", () => {
		const reg = new ProviderRegistry();
		const a = { id: "a" };
		const b = { id: "b" };
		reg.register(TEST_SVC_TOKEN, "a", a);
		reg.register(TEST_SVC_TOKEN, "b", b);
		expect(reg.get(TEST_SVC_TOKEN)).toBe(a);

		const ok = reg.setActive(TEST_SVC_TOKEN, "b");
		expect(ok).toBe(true);
		expect(reg.get(TEST_SVC_TOKEN)).toBe(b);
	});

	it("setActive returns false for unregistered provider", () => {
		const reg = new ProviderRegistry();
		reg.register(TEST_SVC_TOKEN, "a", { id: "a" });
		expect(reg.setActive(TEST_SVC_TOKEN, "nope")).toBe(false);
	});

	it("setActive returns false for unregistered token", () => {
		const reg = new ProviderRegistry();
		expect(reg.setActive(TEST_SVC_TOKEN, "a")).toBe(false);
	});

	it("getByName retrieves a specific named provider", () => {
		const reg = new ProviderRegistry();
		const a = { id: "a" };
		const b = { id: "b" };
		reg.register(TEST_SVC_TOKEN, "a", a);
		reg.register(TEST_SVC_TOKEN, "b", b);
		expect(reg.getByName(TEST_SVC_TOKEN, "a")).toBe(a);
		expect(reg.getByName(TEST_SVC_TOKEN, "b")).toBe(b);
		expect(reg.getByName(TEST_SVC_TOKEN, "c")).toBeNull();
	});

	it("list returns provider names for a token", () => {
		const reg = new ProviderRegistry();
		reg.register(TEST_SVC_TOKEN, "alpha", { id: "alpha" });
		reg.register(TEST_SVC_TOKEN, "beta", { id: "beta" });
		expect(reg.list(TEST_SVC_TOKEN)).toEqual(["alpha", "beta"]);
		expect(reg.list(TEST_UNKNOWN_TOKEN)).toEqual([]);
	});

	it("listTokenIds returns all registered token ids", () => {
		const reg = new ProviderRegistry();
		reg.register(MEMORY_PROVIDER_TOKEN, "default", makeMemoryProvider());
		reg.register(KNOWLEDGE_PROVIDER_TOKEN, "default", makeKnowledgeProvider());
		expect(reg.listTokenIds().sort()).toEqual(["knowledge", "memory"]);
	});

	it("register replaces an existing provider with the same name", () => {
		const reg = new ProviderRegistry();
		const v1 = { id: "v1" };
		const v2 = { id: "v2" };
		reg.register(TEST_SVC_TOKEN, "impl", v1);
		expect(reg.get(TEST_SVC_TOKEN)).toBe(v1);

		reg.register(TEST_SVC_TOKEN, "impl", v2);
		expect(reg.get(TEST_SVC_TOKEN)).toBe(v2);
		expect(reg.list(TEST_SVC_TOKEN)).toEqual(["impl"]);
	});

	it("get returns null for unregistered token", () => {
		const reg = new ProviderRegistry();
		expect(reg.get(TEST_UNKNOWN_TOKEN)).toBeNull();
	});

	it("clear removes all providers", () => {
		const reg = new ProviderRegistry();
		reg.register(MEMORY_PROVIDER_TOKEN, "a", makeMemoryProvider());
		reg.register(KNOWLEDGE_PROVIDER_TOKEN, "b", makeKnowledgeProvider());
		reg.clear();
		expect(reg.get(MEMORY_PROVIDER_TOKEN)).toBeNull();
		expect(reg.get(KNOWLEDGE_PROVIDER_TOKEN)).toBeNull();
		expect(reg.listTokenIds()).toEqual([]);
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

// Interface conformance between provider interfaces and their concrete
// module-owned stores lives at
// `src/provider-registry-conformance.integration.test.ts`, which can
// legitimately import from `#modules/*`.

// --- Convenience getter tests ---

describe("convenience getters", () => {
	afterEach(() => resetProviderRegistry());

	it("getMemoryProvider throws when no provider registered", () => {
		resetProviderRegistry();
		expect(() => getMemoryProvider()).toThrow(
			/No memory provider registered/,
		);
	});

	it("getMemoryProvider throws when registry exists but no memory provider registered", () => {
		initProviderRegistry();
		expect(() => getMemoryProvider()).toThrow(
			/No memory provider registered/,
		);
	});

	it("getKnowledgeProvider throws when no provider registered", () => {
		resetProviderRegistry();
		expect(() => getKnowledgeProvider()).toThrow(
			/No knowledge provider registered/,
		);
	});

	it("getKnowledgeProvider throws when registry exists but no knowledge provider registered", () => {
		initProviderRegistry();
		expect(() => getKnowledgeProvider()).toThrow(
			/No knowledge provider registered/,
		);
	});

	it("getMemoryProvider returns custom provider when registered", () => {
		const reg = initProviderRegistry();
		const custom: MemoryProvider = {
			save: () => "custom-id",
			search: () => [],
			list: () => [],
			update: () => true,
			delete: () => true,
			supportsSemanticSearch: () => true,
			semanticSearch: async () => [],
			reindex: async () => ({ indexed: 0, failed: 0, skipped: true }),
		};
		reg.register(MEMORY_PROVIDER_TOKEN, "custom", custom);
		reg.setActive(MEMORY_PROVIDER_TOKEN, "custom");

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
			supportsSemanticSearch: () => true,
			semanticSearch: async () => [],
			reindex: async () => ({ indexed: 0, failed: 0, skipped: true }),
		};
		reg.register(KNOWLEDGE_PROVIDER_TOKEN, "custom", custom);
		reg.setActive(KNOWLEDGE_PROVIDER_TOKEN, "custom");

		const provider = getKnowledgeProvider();
		expect(provider).toBe(custom);
		expect(provider.count()).toBe(42);
	});

	it("getTaskProvider returns TaskStore when no registry", () => {
		resetProviderRegistry();
		const provider = getTaskProvider();
		expect(typeof provider.add).toBe("function");
		expect(typeof provider.list).toBe("function");
	});

	it("getTaskProvider returns custom provider when registered", () => {
		const reg = initProviderRegistry();
		const custom: TaskProvider = {
			add: () => ({ id: 99, task: "custom", status: "pending", created: "" }),
			update: () => ({ id: 99, task: "custom", status: "done", created: "" }),
			list: () => [],
			active: () => [],
			get: () => undefined,
			clear: () => {},
			archiveCompleted: () => 0,
			getActiveSummary: () => null,
			isEmpty: () => true,
			count: () => 0,
		};
		reg.register(TASK_PROVIDER_TOKEN, "custom", custom);
		reg.setActive(TASK_PROVIDER_TOKEN, "custom");

		const provider = getTaskProvider();
		expect(provider).toBe(custom);
		expect(provider.count()).toBe(0);
	});

	it("getTaskProvider returns default when registry exists but has no task provider", () => {
		initProviderRegistry();
		const provider = getTaskProvider();
		expect(typeof provider.add).toBe("function");
	});

	it("getHistoryProvider throws when no provider registered", () => {
		resetProviderRegistry();
		expect(() => getHistoryProvider()).toThrow(
			/No history provider registered/,
		);
	});

	it("getHistoryProvider throws when registry exists but no history provider registered", () => {
		initProviderRegistry();
		expect(() => getHistoryProvider()).toThrow(
			/No history provider registered/,
		);
	});

	it("getHistoryProvider returns custom provider when registered", () => {
		const reg = initProviderRegistry();
		const custom: HistoryProvider = {
			create: () => "custom-id",
			save: () => {},
			load: () => null,
			list: () => [],
			getMostRecent: () => null,
			findByPrefix: () => null,
			remove: () => false,
			cleanup: () => 0,
			supportsSemanticSearch: () => false,
			semanticSearch: async () => [],
			reindex: async () => ({ indexed: 0, failed: 0, skipped: true }),
		};
		reg.register(HISTORY_PROVIDER_TOKEN, "custom", custom);
		reg.setActive(HISTORY_PROVIDER_TOKEN, "custom");

		const provider = getHistoryProvider();
		expect(provider).toBe(custom);
		expect(provider.create("model", "/tmp")).toBe("custom-id");
	});

});

// --- registerDefaultProviders tests ---

describe("registerDefaultProviders", () => {
	afterEach(() => resetProviderRegistry());

	it("registers default providers for core-owned service types", () => {
		const reg = initProviderRegistry();
		registerDefaultProviders();
		expect(reg.list(MEMORY_PROVIDER_TOKEN)).toEqual([]);
		expect(reg.list(TASK_PROVIDER_TOKEN)).toEqual(["default"]);
		expect(reg.list(HISTORY_PROVIDER_TOKEN)).toEqual([]);
		expect(reg.list(KNOWLEDGE_PROVIDER_TOKEN)).toEqual([]);
		expect(reg.getActiveName(TASK_PROVIDER_TOKEN)).toBe("default");
	});

	it("default providers are functional", () => {
		initProviderRegistry();
		registerDefaultProviders();
		const task = getTaskProvider();
		expect(typeof task.add).toBe("function");
	});

	it("does nothing when registry not initialized", () => {
		resetProviderRegistry();
		// Should not throw
		registerDefaultProviders();
	});

	it("custom provider overrides default when setActive", () => {
		const reg = initProviderRegistry();
		registerDefaultProviders();

		const custom: MemoryProvider = {
			save: () => "from-custom",
			search: () => [],
			list: () => [],
			update: () => true,
			delete: () => true,
			supportsSemanticSearch: () => true,
			semanticSearch: async () => [],
			reindex: async () => ({ indexed: 0, failed: 0, skipped: true }),
		};
		reg.register(MEMORY_PROVIDER_TOKEN, "my-module", custom);
		reg.setActive(MEMORY_PROVIDER_TOKEN, "my-module");

		expect(getMemoryProvider()).toBe(custom);
	});
});

function makeMemoryProvider(): MemoryProvider {
	return {
		save: () => "id",
		search: () => [],
		list: () => [],
		update: () => true,
		delete: () => true,
		supportsSemanticSearch: () => false,
		semanticSearch: async () => [],
		reindex: async () => ({ indexed: 0, failed: 0, skipped: true }),
	};
}

function makeKnowledgeProvider(): KnowledgeProvider {
	return {
		create: () => "id",
		read: () => null,
		update: () => true,
		delete: () => true,
		search: () => [],
		list: () => [],
		count: () => 0,
		supportsSemanticSearch: () => false,
		semanticSearch: async () => [],
		reindex: async () => ({ indexed: 0, failed: 0, skipped: true }),
	};
}
