import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseKnowledgeFile } from "./store-helpers.js";

function writeMd(dir: string, filename: string, lines: string[]): void {
	writeFileSync(join(dir, filename), lines.join("\n"), "utf-8");
}

describe("parseKnowledgeFile work-memory metadata", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "ksh-metadata-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("parses reserved provenance and freshness keys into structured metadata", () => {
		writeMd(tmpDir, "provenance.md", [
			"---",
			"id: provenance-id",
			"title: Provenance Entry",
			"provenance_source_kind: file",
			"provenance_source_path: docs/ARCHITECTURE.md",
			"provenance_observed_at: 2026-04-26T12:34:56Z",
			"freshness_status: stale",
			"freshness_changed_at: 2026-04-27T09:15:00Z",
			"freshness_note: owner corrected later",
			"---",
			"body",
		]);
		const entry = parseKnowledgeFile(tmpDir, "provenance.md");
		expect(entry).not.toBeNull();
		expect(entry!.provenance).toMatchObject({
			sourceKind: "file",
			sourcePath: "docs/ARCHITECTURE.md",
		});
		expect(entry!.freshness).toMatchObject({
			status: "stale",
			note: "owner corrected later",
		});
		expect(entry!.meta.provenance_source_kind).toBeUndefined();
		expect(entry!.meta.freshness_status).toBeUndefined();
	});
});
