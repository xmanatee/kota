import type {
	WorkMemoryFreshness,
	WorkMemoryMetadata,
	WorkMemoryProvenance,
} from "./work-memory-metadata-types.js";

export function formatWorkMemoryMetadata(
	metadata: WorkMemoryMetadata | undefined,
): string {
	const parts: string[] = [];
	if (metadata?.provenance) {
		const provenance = metadata.provenance;
		parts.push(
			`${formatProvenanceLocator(provenance)} observed ${formatIsoDate(
				provenance.observedAt,
			)}`,
		);
	}
	if (metadata?.freshness) {
		parts.push(formatFreshness(metadata.freshness));
	}
	return parts.join("; ");
}

function formatProvenanceLocator(provenance: WorkMemoryProvenance): string {
	switch (provenance.sourceKind) {
		case "run":
		case "session":
			return `${provenance.sourceKind}:${provenance.sourceId ?? "unknown"}`;
		case "file":
			return `file:${provenance.sourcePath ?? "unknown"}`;
		case "url":
			return `url:${provenance.sourceUrl ?? "unknown"}`;
		case "tool":
			return `tool:${provenance.sourceTool ?? provenance.sourceId ?? "unknown"}`;
		case "manual":
			return "manual";
	}
}

function formatFreshness(freshness: WorkMemoryFreshness): string {
	const suffix = freshness.replacementId
		? ` -> ${freshness.replacementId}`
		: "";
	if (freshness.changedAt) {
		return `${freshness.status}${suffix} ${formatIsoDate(freshness.changedAt)}`;
	}
	return `${freshness.status}${suffix}`;
}

function formatIsoDate(value: string): string {
	return value.slice(0, 10);
}
