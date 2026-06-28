import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KnowledgeEntry } from "#core/modules/provider-types.js";
import {
	exportOkfBundle,
	OkfBundleError,
	validateOkfBundle,
} from "./okf.js";

describe("OKF export", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "kota-okf-export-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("exports selected knowledge entries as a valid OKF bundle", () => {
		const outputDir = join(tempDir, "out");
		const result = exportOkfBundle({
			outputDir,
			entries: [
				makeEntry({
					id: "orders",
					title: "Orders",
					type: "BigQuery Table",
					tags: ["sales"],
					content: "See [Customers](customers.md).",
					meta: {
						okf_concept_id: "tables/orders",
						description: "Order facts.",
						resource: "https://example.test/orders",
						"producer.version": "v2",
						"gcp:semantic-type": "fact-table",
					},
				}),
				makeEntry({
					id: "customers",
					title: "Customers",
					type: "BigQuery Table",
					meta: { okf_concept_id: "tables/customers" },
				}),
			],
		});

		expect(result.count).toBe(2);
		expect(result.lossy).toEqual([]);
		expect(existsSync(join(outputDir, "index.md"))).toBe(true);
		expect(readFileSync(join(outputDir, "index.md"), "utf-8")).toContain('okf_version: "0.1"');
		const ordersRaw = readFileSync(join(outputDir, "tables", "orders.md"), "utf-8");
		expect(ordersRaw).toContain("producer.version: v2");
		expect(ordersRaw).toContain("gcp:semantic-type: fact-table");
		const validation = validateOkfBundle(outputDir);
		expect(validation.ok).toBe(true);
		if (!validation.ok) return;
		expect(validation.bundle.concepts.map((concept) => concept.conceptId).sort()).toEqual([
			"tables/customers",
			"tables/orders",
		]);
	});

	it("fails for unsupported output paths and colliding concept ids", () => {
		const outputFile = join(tempDir, "file.md");
		writeFileSync(outputFile, "not a directory", "utf-8");
		expect(() =>
			exportOkfBundle({ outputDir: outputFile, entries: [] }),
		).toThrow(OkfBundleError);

		const outputDir = join(tempDir, "collision");
		expect(() =>
			exportOkfBundle({
				outputDir,
				entries: [
					makeEntry({ id: "a", title: "A", meta: { okf_concept_id: "same" } }),
					makeEntry({ id: "b", title: "B", meta: { okf_concept_id: "same" } }),
				],
			}),
		).toThrow(OkfBundleError);
	});
});

function makeEntry(overrides: Partial<KnowledgeEntry>): KnowledgeEntry {
	return {
		id: overrides.id ?? "entry",
		title: overrides.title ?? "Entry",
		type: overrides.type ?? "Reference",
		tags: overrides.tags ?? [],
		status: overrides.status ?? "active",
		created: overrides.created ?? "2026-06-28T00:00:00.000Z",
		updated: overrides.updated ?? "2026-06-28T00:00:00.000Z",
		content: overrides.content ?? "Body",
		meta: overrides.meta ?? {},
	};
}
