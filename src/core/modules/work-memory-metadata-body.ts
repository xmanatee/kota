import { parseWorkMemoryMetadata } from "./work-memory-metadata-parse.js";
import type {
	WorkMemoryFreshnessInput,
	WorkMemoryMetadata,
	WorkMemoryProvenanceInput,
} from "./work-memory-metadata-types.js";

type MetadataBodyField =
	| object
	| string
	| number
	| boolean
	| null
	| undefined;

type MetadataBody = {
	provenance?: MetadataBodyField;
	freshness?: MetadataBodyField;
};

export type WorkMemoryMetadataBodyParseResult =
	| { ok: true; metadata: WorkMemoryMetadata | undefined }
	| { ok: false; message: string };

export function parseWorkMemoryMetadataFromBody(
	body: object,
): WorkMemoryMetadataBodyParseResult {
	const record = body as MetadataBody;
	const provenanceRaw = record.provenance;
	const freshnessRaw = record.freshness;
	if (!isNullableObject(provenanceRaw)) {
		return { ok: false, message: "provenance must be an object or null" };
	}
	if (!isNullableObject(freshnessRaw)) {
		return { ok: false, message: "freshness must be an object or null" };
	}
	const parsed = parseWorkMemoryMetadata({
		provenance: provenanceRaw ? objectToProvenanceInput(provenanceRaw) : null,
		freshness: freshnessRaw ? objectToFreshnessInput(freshnessRaw) : null,
	});
	return parsed.ok ? parsed : { ok: false, message: parsed.message };
}

function isNullableObject(value: MetadataBodyField): value is object | null | undefined {
	return value === undefined || value === null || typeof value === "object";
}

function objectToProvenanceInput(value: object): WorkMemoryProvenanceInput {
	return {
		sourceKind: stringField(value, "sourceKind"),
		observedAt: stringField(value, "observedAt"),
		sourceId: stringField(value, "sourceId"),
		sourcePath: stringField(value, "sourcePath"),
		sourceUrl: stringField(value, "sourceUrl"),
		sourceTool: stringField(value, "sourceTool"),
		note: stringField(value, "note"),
	};
}

function objectToFreshnessInput(value: object): WorkMemoryFreshnessInput {
	return {
		status: stringField(value, "status"),
		changedAt: stringField(value, "changedAt"),
		note: stringField(value, "note"),
		replacementId: stringField(value, "replacementId"),
	};
}

function stringField(value: object, key: string): string | undefined {
	const record = value as Record<string, string | undefined>;
	return typeof record[key] === "string" ? record[key] : undefined;
}
