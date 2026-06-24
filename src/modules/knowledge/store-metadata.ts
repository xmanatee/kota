import {
	isWorkMemoryMetadataKey,
	parseWorkMemoryMetadata,
	type WorkMemoryMetadata,
	writeWorkMemoryMetadataToFlatFields,
} from "#core/modules/work-memory-metadata.js";

type FrontMatterAttrs = Record<string, string | string[]>;

export type KnowledgeStoreMetadataInput = {
	provenance?: WorkMemoryMetadata["provenance"];
	freshness?: WorkMemoryMetadata["freshness"];
};

export type KnowledgeStoreMetadataChanges = {
	meta?: Record<string, string>;
	provenance?: WorkMemoryMetadata["provenance"] | null;
	freshness?: WorkMemoryMetadata["freshness"] | null;
};

export function cleanKnowledgeMeta(
	meta: Record<string, string>,
): Record<string, string> {
	const cleaned: Record<string, string> = {};
	for (const [key, value] of Object.entries(meta)) {
		if (!isWorkMemoryMetadataKey(key)) cleaned[key] = value;
	}
	return cleaned;
}

export function workMemoryMetadataFields(
	metadata: KnowledgeStoreMetadataInput,
): Record<string, string> {
	return writeWorkMemoryMetadataToFlatFields(
		normalizeWorkMemoryMetadata(metadata),
	);
}

export function applyKnowledgeMetadataChanges(
	attrs: FrontMatterAttrs,
	changes: KnowledgeStoreMetadataChanges,
): void {
	if (changes.meta) {
		Object.assign(attrs, cleanKnowledgeMeta(changes.meta));
	}
	if (changes.provenance !== undefined) {
		clearPrefixedAttrs(attrs, "provenance_");
		if (changes.provenance !== null) {
			Object.assign(
				attrs,
				workMemoryMetadataFields({
					provenance: changes.provenance,
					...(changes.freshness !== undefined &&
						changes.freshness !== null && { freshness: changes.freshness }),
				}),
			);
		}
	}
	if (changes.freshness !== undefined) {
		clearPrefixedAttrs(attrs, "freshness_");
		if (changes.freshness !== null) {
			Object.assign(
				attrs,
				workMemoryMetadataFields({
					...(changes.provenance !== undefined &&
						changes.provenance !== null && { provenance: changes.provenance }),
					freshness: changes.freshness,
				}),
			);
		}
	}
}

function normalizeWorkMemoryMetadata(
	metadata: KnowledgeStoreMetadataInput,
): WorkMemoryMetadata | undefined {
	const parsed = parseWorkMemoryMetadata({
		provenance: metadata.provenance ?? null,
		freshness: metadata.freshness ?? null,
	});
	return parsed.ok ? parsed.metadata : undefined;
}

function clearPrefixedAttrs(attrs: FrontMatterAttrs, prefix: string): void {
	for (const key of Object.keys(attrs)) {
		if (key.startsWith(prefix)) delete attrs[key];
	}
}
