export const WORK_MEMORY_SOURCE_KINDS = [
	"run",
	"session",
	"file",
	"url",
	"tool",
	"manual",
] as const;

export type WorkMemorySourceKind =
	(typeof WORK_MEMORY_SOURCE_KINDS)[number];

export const WORK_MEMORY_FRESHNESS_STATES = [
	"current",
	"stale",
	"superseded",
	"retracted",
] as const;

export type WorkMemoryFreshnessState =
	(typeof WORK_MEMORY_FRESHNESS_STATES)[number];

export type WorkMemoryProvenance = {
	sourceKind: WorkMemorySourceKind;
	observedAt: string;
	sourceId?: string;
	sourcePath?: string;
	sourceUrl?: string;
	sourceTool?: string;
	note?: string;
};

export type WorkMemoryFreshness = {
	status: WorkMemoryFreshnessState;
	changedAt?: string;
	note?: string;
	replacementId?: string;
};

export type WorkMemoryMetadata = {
	provenance?: WorkMemoryProvenance;
	freshness?: WorkMemoryFreshness;
};

export type WorkMemoryProvenanceInput = {
	sourceKind?: string;
	observedAt?: string;
	sourceId?: string;
	sourcePath?: string;
	sourceUrl?: string;
	sourceTool?: string;
	note?: string;
};

export type WorkMemoryFreshnessInput = {
	status?: string;
	changedAt?: string;
	note?: string;
	replacementId?: string;
};

export type WorkMemoryMetadataInput = {
	provenance?: WorkMemoryProvenanceInput | null;
	freshness?: WorkMemoryFreshnessInput | null;
};

export type WorkMemoryMetadataParseResult =
	| { ok: true; metadata: WorkMemoryMetadata | undefined }
	| { ok: false; message: string };

const RESERVED_METADATA_KEYS = new Set([
	"provenance_source_kind",
	"provenance_source_id",
	"provenance_source_path",
	"provenance_source_url",
	"provenance_source_tool",
	"provenance_observed_at",
	"provenance_note",
	"freshness_status",
	"freshness_changed_at",
	"freshness_note",
	"freshness_replacement_id",
]);

export function isWorkMemoryMetadataKey(key: string): boolean {
	return RESERVED_METADATA_KEYS.has(key);
}

export function isWorkMemorySourceKind(
	value: string,
): value is WorkMemorySourceKind {
	return WORK_MEMORY_SOURCE_KINDS.includes(value as WorkMemorySourceKind);
}

export function isWorkMemoryFreshnessState(
	value: string,
): value is WorkMemoryFreshnessState {
	return WORK_MEMORY_FRESHNESS_STATES.includes(
		value as WorkMemoryFreshnessState,
	);
}
