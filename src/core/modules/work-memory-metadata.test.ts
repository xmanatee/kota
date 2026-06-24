import { describe, expect, it } from "vitest";
import {
	formatWorkMemoryMetadata,
	parseWorkMemoryMetadata,
	readWorkMemoryMetadataFromFlatFields,
	writeWorkMemoryMetadataToFlatFields,
} from "./work-memory-metadata.js";

describe("work-memory metadata", () => {
	it("parses provenance with default current freshness", () => {
		const parsed = parseWorkMemoryMetadata({
			provenance: {
				sourceKind: "run",
				sourceId: "run-123",
				observedAt: "2026-04-25T08:00:00Z",
			},
		});
		expect(parsed).toMatchObject({
			ok: true,
			metadata: {
				provenance: {
					sourceKind: "run",
					sourceId: "run-123",
					observedAt: "2026-04-25T08:00:00.000Z",
				},
				freshness: { status: "current" },
			},
		});
	});

	it("rejects credential-bearing source URLs", () => {
		const parsed = parseWorkMemoryMetadata({
			provenance: {
				sourceKind: "url",
				sourceUrl: "https://token:secret@example.com/path",
				observedAt: "2026-04-25T08:00:00Z",
			},
		});
		expect(parsed).toEqual({
			ok: false,
			message:
				"provenance.sourceUrl must be http(s) without embedded credentials",
		});
	});

	it("round-trips flat frontmatter fields and renders concise details", () => {
		const metadata = readWorkMemoryMetadataFromFlatFields({
			provenance_source_kind: "file",
			provenance_source_path: "docs/ARCHITECTURE.md",
			provenance_observed_at: "2026-04-26T12:34:56Z",
			freshness_status: "superseded",
			freshness_changed_at: "2026-04-27T09:15:00Z",
			freshness_replacement_id: "kn-next",
		});
		expect(metadata).toMatchObject({
			provenance: { sourceKind: "file", sourcePath: "docs/ARCHITECTURE.md" },
			freshness: { status: "superseded", replacementId: "kn-next" },
		});
		expect(writeWorkMemoryMetadataToFlatFields(metadata)).toMatchObject({
			provenance_source_kind: "file",
			provenance_source_path: "docs/ARCHITECTURE.md",
			freshness_status: "superseded",
			freshness_replacement_id: "kn-next",
		});
		expect(formatWorkMemoryMetadata(metadata)).toBe(
			"file:docs/ARCHITECTURE.md observed 2026-04-26; superseded -> kn-next 2026-04-27",
		);
	});
});
