import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KnowledgeEntry } from "#core/modules/provider-types.js";
import {
	buildOkfImportPlan,
	OkfBundleError,
	readOkfBundle,
} from "./okf.js";

describe("OKF import mapping", () => {
	let tempDir: string;
	let bundleDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "kota-okf-import-"));
		bundleDir = join(tempDir, "bundle");
		mkdirSync(bundleDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("maps scalar metadata and reports array/object fields as lossy", () => {
		writeFileSync(
			join(bundleDir, "concept.md"),
			[
				"---",
				"type: Playbook",
				"title: Incident Response",
				"description: Triage steps.",
				"resource: https://example.test/runbook",
				"producer.version: v2",
				"gcp:semantic-type: fact-table",
				"tags:",
				"  - oncall",
				"  - incident",
				"aliases: [ir, outage]",
				"owners:",
				"  primary: ops",
				"---",
				"See [neighbor](./neighbor.md).",
				"",
			].join("\n"),
			"utf-8",
		);
		writeFileSync(join(bundleDir, "neighbor.md"), "---\ntype: Reference\n---\nNeighbor.\n", "utf-8");

		const bundle = readOkfBundle(bundleDir);
		const plan = buildOkfImportPlan(bundle, [], { status: "active" });
		const entry = plan.entries.find((item) => item.meta.okf_concept_id === "concept");
		expect(entry).toMatchObject({
			title: "Incident Response",
			type: "Playbook",
			tags: ["oncall", "incident"],
			status: "active",
		});
		expect(entry?.meta).toMatchObject({
			description: "Triage steps.",
			resource: "https://example.test/runbook",
			"producer.version": "v2",
			"gcp:semantic-type": "fact-table",
			okf_links: "neighbor",
		});
		expect(plan.lossy.map((item) => item.field).sort()).toEqual(["aliases", "owners"]);
	});

	it("fails when an imported concept would collide with existing OKF metadata", () => {
		writeFileSync(join(bundleDir, "concept.md"), "---\ntype: Reference\n---\nBody\n", "utf-8");
		const bundle = readOkfBundle(bundleDir);
		const existing = [
			makeEntry({
				id: "existing",
				title: "Existing",
				meta: { okf_concept_id: "concept" },
			}),
		];

		expect(() => buildOkfImportPlan(bundle, existing)).toThrow(OkfBundleError);
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
