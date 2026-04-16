/**
 * Sidecar embedding index — persists entry embeddings as a JSON file per
 * storage directory (project and/or global). The index is a cache keyed by
 * entry id; it can be rebuilt at any time from the underlying entries.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const INDEX_FILENAME = ".embeddings.json";
export const INDEX_VERSION = 1;

export type IndexedEmbedding = {
	/** Entry `updated` timestamp snapshotted when the embedding was computed. */
	updated: string;
	embedding: number[];
};

export type SemanticIndex = {
	version: number;
	model: string;
	entries: Record<string, IndexedEmbedding>;
};

function emptyIndex(model: string): SemanticIndex {
	return { version: INDEX_VERSION, model, entries: {} };
}

/** Persistent sidecar index backed by a JSON file. */
export class SemanticIndexFile {
	constructor(private path: string) {}

	/** Directory containing the index file. Exposed for tests. */
	get directory(): string {
		return dirname(this.path);
	}

	/** Load the index, or return an empty index bound to the given model. */
	load(model: string): SemanticIndex {
		if (!existsSync(this.path)) return emptyIndex(model);
		try {
			const raw = readFileSync(this.path, "utf-8");
			const parsed = JSON.parse(raw) as Partial<SemanticIndex>;
			if (parsed.version !== INDEX_VERSION) return emptyIndex(model);
			if (typeof parsed.model !== "string") return emptyIndex(model);
			// If the model changed, the cached embeddings are incompatible.
			if (parsed.model !== model) return emptyIndex(model);
			const entries = parsed.entries ?? {};
			const clean: Record<string, IndexedEmbedding> = {};
			for (const [id, value] of Object.entries(entries)) {
				if (
					value &&
					Array.isArray(value.embedding) &&
					typeof value.updated === "string"
				) {
					clean[id] = {
						updated: value.updated,
						embedding: value.embedding.slice(),
					};
				}
			}
			return { version: INDEX_VERSION, model: parsed.model, entries: clean };
		} catch {
			return emptyIndex(model);
		}
	}

	save(index: SemanticIndex): void {
		const dir = dirname(this.path);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		// Compact JSON — embeddings are large dense vectors and indented output
		// balloons the file size without adding any human-readable value.
		writeFileSync(this.path, JSON.stringify(index), "utf-8");
	}
}

export function indexPathFor(storageDir: string): string {
	return join(storageDir, INDEX_FILENAME);
}
