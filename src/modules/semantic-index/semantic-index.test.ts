import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	INDEX_FILENAME,
	INDEX_VERSION,
	indexPathFor,
	type SemanticIndex,
	SemanticIndexFile,
} from "./semantic-index.js";

describe("SemanticIndexFile", () => {
	let dir: string;
	let path: string;

	beforeEach(() => {
		dir = join(
			tmpdir(),
			`kota-sem-index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		mkdirSync(dir, { recursive: true });
		path = indexPathFor(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("indexPathFor places the file under the storage dir", () => {
		expect(path).toBe(join(dir, INDEX_FILENAME));
	});

	it("returns empty index when file missing", () => {
		const file = new SemanticIndexFile(path);
		const index = file.load("model-a");
		expect(index.version).toBe(INDEX_VERSION);
		expect(index.model).toBe("model-a");
		expect(index.entries).toEqual({});
	});

	it("persists entries across save/load", () => {
		const file = new SemanticIndexFile(path);
		const saved: SemanticIndex = {
			version: INDEX_VERSION,
			model: "model-a",
			entries: {
				alpha: { fingerprint: "fp-1", embedding: [0.1, 0.2, 0.3] },
			},
		};
		file.save(saved);
		expect(existsSync(path)).toBe(true);
		const loaded = file.load("model-a");
		expect(loaded.entries.alpha.embedding).toEqual([0.1, 0.2, 0.3]);
		expect(loaded.entries.alpha.fingerprint).toBe("fp-1");
	});

	it("returns empty index when model differs (cache invalidation)", () => {
		const file = new SemanticIndexFile(path);
		file.save({
			version: INDEX_VERSION,
			model: "model-a",
			entries: { alpha: { fingerprint: "fp", embedding: [1, 2] } },
		});
		const loaded = file.load("model-b");
		expect(loaded.entries).toEqual({});
		expect(loaded.model).toBe("model-b");
	});

	it("returns empty index when version differs", () => {
		writeFileSync(
			path,
			JSON.stringify({
				version: 99,
				model: "model-a",
				entries: { x: { fingerprint: "fp", embedding: [1] } },
			}),
		);
		const loaded = new SemanticIndexFile(path).load("model-a");
		expect(loaded.entries).toEqual({});
	});

	it("ignores malformed entries", () => {
		writeFileSync(
			path,
			JSON.stringify({
				version: INDEX_VERSION,
				model: "m",
				entries: {
					good: { fingerprint: "fp", embedding: [1, 2] },
					noEmbedding: { fingerprint: "fp" },
					noFingerprint: { embedding: [3, 4] },
				},
			}),
		);
		const loaded = new SemanticIndexFile(path).load("m");
		expect(Object.keys(loaded.entries)).toEqual(["good"]);
	});

	it("creates parent directory on save", () => {
		const nested = join(dir, "a", "b", "c");
		const file = new SemanticIndexFile(join(nested, INDEX_FILENAME));
		file.save({ version: INDEX_VERSION, model: "m", entries: {} });
		expect(existsSync(join(nested, INDEX_FILENAME))).toBe(true);
	});
});
