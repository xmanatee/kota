import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "#modules/memory/store.js";
import type { EmbeddingProvider } from "#modules/semantic-index/embedding-provider.js";
import { SemanticMemoryStore } from "./semantic-store.js";

class StaticEmbeddingProvider implements EmbeddingProvider {
	readonly name = "static";
	readonly model = "static-model-v1";

	async embed(texts: string[]): Promise<number[][]> {
		return texts.map(() => [1, 0, 0]);
	}
}

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`kota-mem-sem-metadata-${Date.now()}-${Math.random()
			.toString(36)
			.slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("SemanticMemoryStore work-memory metadata", () => {
	let storeDir: string;
	let store: SemanticMemoryStore;

	beforeEach(() => {
		storeDir = makeTmpDir();
		store = new SemanticMemoryStore({
			base: new MemoryStore(storeDir),
			provider: new StaticEmbeddingProvider(),
		});
	});

	afterEach(() => {
		rmSync(storeDir, { recursive: true, force: true });
	});

	it("returns canonical provenance and freshness from semantic results", async () => {
		const id = store.save("monitor spend and cost anomaly", ["budget"], {
			provenance: {
				sourceKind: "run",
				sourceId: "run-semantic",
				observedAt: "2026-04-25T08:00:00.000Z",
			},
			freshness: { status: "current" },
		});
		await store.flush();

		store.update(id, {
			freshness: {
				status: "superseded",
				changedAt: "2026-04-27T09:15:00.000Z",
				replacementId: "mem-next",
			},
		});
		const [result] = await store.semanticSearch("workflow cost tracking", 5);
		expect(result.id).toBe(id);
		expect(result.provenance).toMatchObject({ sourceId: "run-semantic" });
		expect(result.freshness).toMatchObject({
			status: "superseded",
			replacementId: "mem-next",
		});
	});
});
