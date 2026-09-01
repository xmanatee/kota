import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import { MemoryScopeStores } from "./scope.js";
import { MemoryStore } from "./store.js";

describe("MemoryScopeStores", () => {
	it("shares one non-default store across independent scope resolvers", () => {
		const root = mkdtempSync(join(tmpdir(), "kota-memory-scope-owner-"));
		try {
			const defaultRoot = join(root, "default");
			const selectedRoot = join(root, "selected");
			mkdirSync(defaultRoot);
			mkdirSync(selectedRoot);
			const defaultScope = buildDirectoryScope({ scopeRoot: defaultRoot });
			const selectedScope = buildDirectoryScope({ scopeRoot: selectedRoot });
			const options = {
				defaultScopeRoot: defaultRoot,
				defaultScopeId: defaultScope.scopeId,
				scopes: [defaultScope, selectedScope],
			} as const;
			const captureScopes = new MemoryScopeStores(options);
			const retractScopes = new MemoryScopeStores(options);

			const capture = captureScopes.resolve(selectedScope.scopeId);
			const retract = retractScopes.resolve(selectedScope.scopeId);
			expect(capture.ok).toBe(true);
			expect(retract.ok).toBe(true);
			if (!capture.ok || !retract.ok) return;
			expect(capture.store).toBe(retract.store);

			const removedId = capture.store.save("remove A");
			expect(retract.store.delete(removedId)).toBe(true);
			capture.store.save("retain B");

			const persisted = new MemoryStore(join(selectedRoot, ".kota")).list();
			expect(persisted.map((memory) => memory.content)).toEqual(["retain B"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
