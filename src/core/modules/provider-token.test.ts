/**
 * Type-level and runtime guards for the typed `ProviderToken` API.
 *
 * The token protocol exists to make provider misuse a compile-time error:
 * a wrong-shape provider must not be registrable, and a wrong-typed
 * `getProvider` consumer must not compile. The `@ts-expect-error` comments
 * here are the load-bearing assertion — `tsc --noEmit` must report each
 * marked line as failing for these guards to do their job. A missing or
 * stale comment will fail the typecheck loudly.
 */

import { describe, expect, it } from "vitest";
import {
	defineProviderToken,
	type MemoryProvider,
	ProviderRegistry,
} from "./provider-registry.js";

interface DemoProvider {
	demo(): number;
}

const DEMO_TOKEN = defineProviderToken<DemoProvider>("demo");

const goodMemory: MemoryProvider = {
	save: () => "id",
	search: () => [],
	list: () => [],
	update: () => true,
	delete: () => true,
	supportsSemanticSearch: () => false,
	semanticSearch: async () => [],
	reindex: async () => ({ indexed: 0, failed: 0, skipped: true }),
};

describe("ProviderToken typing", () => {
	it("accepts a value that matches the token's type", () => {
		const reg = new ProviderRegistry();
		reg.register(DEMO_TOKEN, "default", { demo: () => 42 });
		const got = reg.get(DEMO_TOKEN);
		expect(got?.demo()).toBe(42);
	});

	it("rejects a wrong-shape provider for a typed token", () => {
		const reg = new ProviderRegistry();
		// @ts-expect-error wrong-shape provider for DEMO_TOKEN
		reg.register(DEMO_TOKEN, "bad", { unrelated: true });
	});

	it("rejects a plain string id where a ProviderToken is required", () => {
		const reg = new ProviderRegistry();
		// @ts-expect-error plain strings are not ProviderToken values
		reg.register("memory", "default", goodMemory);
	});

	it("rejects retrieval under a token whose type does not match the consumer", () => {
		const reg = new ProviderRegistry();
		reg.register(DEMO_TOKEN, "default", { demo: () => 1 });
		// @ts-expect-error the demo token returns DemoProvider, not MemoryProvider
		const wrong: MemoryProvider | null = reg.get(DEMO_TOKEN);
		void wrong;
	});

	it("introspect read-by-id is allowed for diagnostic surfaces", () => {
		const reg = new ProviderRegistry();
		reg.register(DEMO_TOKEN, "alpha", { demo: () => 1 });
		const snapshot = reg.introspect("demo");
		expect(snapshot.active).toBe("alpha");
		expect(snapshot.names).toEqual(["alpha"]);
	});
});
