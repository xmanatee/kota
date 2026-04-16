/**
 * Sidecar embedding index — persists entry embeddings as a JSON file per
 * storage directory. The index is a cache keyed by entry id; it can be
 * rebuilt from the underlying entries at any time.
 *
 * The `fingerprint` field is an opaque string that the owning store uses to
 * detect staleness — an ISO timestamp for knowledge, a content hash for
 * memory. When the stored fingerprint differs from the entry's current
 * fingerprint, the cached embedding is recomputed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const INDEX_FILENAME = ".embeddings.json";
export const INDEX_VERSION = 2;

export type IndexedEmbedding = {
	fingerprint: string;
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
			if (parsed.model !== model) return emptyIndex(model);
			const entries = parsed.entries ?? {};
			const clean: Record<string, IndexedEmbedding> = {};
			for (const [id, value] of Object.entries(entries)) {
				if (
					value &&
					Array.isArray(value.embedding) &&
					typeof value.fingerprint === "string"
				) {
					clean[id] = {
						fingerprint: value.fingerprint,
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
		writeFileSync(this.path, JSON.stringify(index), "utf-8");
	}
}

export function indexPathFor(storageDir: string): string {
	return join(storageDir, INDEX_FILENAME);
}
