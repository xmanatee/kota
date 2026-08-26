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

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeJsonFileAtomic } from "#core/util/json-file.js";

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
			return decodeSemanticIndex(JSON.parse(raw) as unknown, model)
				?? emptyIndex(model);
		} catch {
			// The index is a rebuildable cache; malformed cache state is an
			// explicit cache miss, never canonical-memory data loss.
			return emptyIndex(model);
		}
	}

	save(index: SemanticIndex): void {
		writeJsonFileAtomic(this.path, index, (value) => JSON.stringify(value));
	}
}

function decodeSemanticIndex(value: unknown, model: string): SemanticIndex | null {
	if (!isRecord(value) || value.version !== INDEX_VERSION || value.model !== model) return null;
	if (!isRecord(value.entries)) return null;
	const entries: Record<string, IndexedEmbedding> = {};
	for (const [id, entry] of Object.entries(value.entries)) {
		if (
			!isRecord(entry) ||
			typeof entry.fingerprint !== "string" ||
			!Array.isArray(entry.embedding) ||
			!entry.embedding.every((item) => typeof item === "number" && Number.isFinite(item))
		) continue;
		entries[id] = { fingerprint: entry.fingerprint, embedding: [...entry.embedding] };
	}
	return { version: INDEX_VERSION, model, entries };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function indexPathFor(storageDir: string): string {
	return join(storageDir, INDEX_FILENAME);
}
