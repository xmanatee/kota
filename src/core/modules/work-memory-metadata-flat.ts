import { parseWorkMemoryMetadata } from "./work-memory-metadata-parse.js";
import type { WorkMemoryMetadata } from "./work-memory-metadata-types.js";

export function readWorkMemoryMetadataFromFlatFields(
	fields: Record<string, string>,
): WorkMemoryMetadata | undefined {
	const parsed = parseWorkMemoryMetadata({
		provenance: {
			sourceKind: fields.provenance_source_kind,
			sourceId: fields.provenance_source_id,
			sourcePath: fields.provenance_source_path,
			sourceUrl: fields.provenance_source_url,
			sourceTool: fields.provenance_source_tool,
			observedAt: fields.provenance_observed_at,
			note: fields.provenance_note,
		},
		freshness: {
			status: fields.freshness_status,
			changedAt: fields.freshness_changed_at,
			note: fields.freshness_note,
			replacementId: fields.freshness_replacement_id,
		},
	});
	return parsed.ok ? parsed.metadata : undefined;
}

export function writeWorkMemoryMetadataToFlatFields(
	metadata: WorkMemoryMetadata | undefined,
): Record<string, string> {
	const fields: Record<string, string> = {};
	if (metadata?.provenance) {
		const provenance = metadata.provenance;
		fields.provenance_source_kind = provenance.sourceKind;
		fields.provenance_observed_at = provenance.observedAt;
		if (provenance.sourceId) fields.provenance_source_id = provenance.sourceId;
		if (provenance.sourcePath)
			fields.provenance_source_path = provenance.sourcePath;
		if (provenance.sourceUrl) fields.provenance_source_url = provenance.sourceUrl;
		if (provenance.sourceTool)
			fields.provenance_source_tool = provenance.sourceTool;
		if (provenance.note) fields.provenance_note = provenance.note;
	}
	if (metadata?.freshness) {
		const freshness = metadata.freshness;
		fields.freshness_status = freshness.status;
		if (freshness.changedAt) fields.freshness_changed_at = freshness.changedAt;
		if (freshness.note) fields.freshness_note = freshness.note;
		if (freshness.replacementId)
			fields.freshness_replacement_id = freshness.replacementId;
	}
	return fields;
}
