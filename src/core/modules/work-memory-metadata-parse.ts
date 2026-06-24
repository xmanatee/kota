import {
	isWorkMemoryFreshnessState,
	isWorkMemorySourceKind,
	type WorkMemoryFreshness,
	type WorkMemoryFreshnessInput,
	type WorkMemoryMetadataInput,
	type WorkMemoryMetadataParseResult,
	type WorkMemoryProvenance,
	type WorkMemoryProvenanceInput,
	type WorkMemorySourceKind,
} from "./work-memory-metadata-types.js";

export function parseWorkMemoryMetadata(
	input: WorkMemoryMetadataInput,
): WorkMemoryMetadataParseResult {
	const provenance = parseProvenance(input.provenance);
	if (!provenance.ok) return provenance;
	const freshness = parseFreshness(input.freshness, provenance.value !== undefined);
	if (!freshness.ok) return freshness;
	if (provenance.value === undefined && freshness.value === undefined) {
		return { ok: true, metadata: undefined };
	}
	return {
		ok: true,
		metadata: {
			...(provenance.value !== undefined && { provenance: provenance.value }),
			...(freshness.value !== undefined && { freshness: freshness.value }),
		},
	};
}

function parseProvenance(
	input: WorkMemoryProvenanceInput | null | undefined,
):
	| { ok: true; value: WorkMemoryProvenance | undefined }
	| { ok: false; message: string } {
	if (!input || everyFieldMissing(input)) {
		return { ok: true, value: undefined };
	}
	if (!input.sourceKind || !isWorkMemorySourceKind(input.sourceKind)) {
		return {
			ok: false,
			message:
				"provenance.sourceKind must be one of run, session, file, url, tool, manual",
		};
	}
	if (!input.observedAt) {
		return { ok: false, message: "provenance.observedAt is required" };
	}
	const observedAt = normalizeIsoTimestamp(input.observedAt);
	if (!observedAt) {
		return { ok: false, message: "provenance.observedAt must be ISO 8601" };
	}
	const sourceUrl = input.sourceUrl
		? (normalizePublicHttpUrl(input.sourceUrl) ?? undefined)
		: undefined;
	if (input.sourceUrl && !sourceUrl) {
		return {
			ok: false,
			message:
				"provenance.sourceUrl must be http(s) without embedded credentials",
		};
	}
	const sourceId = clean(input.sourceId);
	const sourcePath = clean(input.sourcePath);
	const sourceTool = clean(input.sourceTool);
	const locatorMessage = validateLocator(input.sourceKind, {
		sourceId,
		sourcePath,
		sourceUrl,
		sourceTool,
	});
	if (locatorMessage) return { ok: false, message: locatorMessage };
	return {
		ok: true,
		value: {
			sourceKind: input.sourceKind,
			observedAt,
			...(sourceId && { sourceId }),
			...(sourcePath && { sourcePath }),
			...(sourceUrl && { sourceUrl }),
			...(sourceTool && { sourceTool }),
			...(clean(input.note) && { note: clean(input.note) }),
		},
	};
}

function parseFreshness(
	input: WorkMemoryFreshnessInput | null | undefined,
	defaultCurrent: boolean,
):
	| { ok: true; value: WorkMemoryFreshness | undefined }
	| { ok: false; message: string } {
	if (!input || everyFieldMissing(input)) {
		return defaultCurrent
			? { ok: true, value: { status: "current" } }
			: { ok: true, value: undefined };
	}
	const status = input.status ?? "current";
	if (!isWorkMemoryFreshnessState(status)) {
		return {
			ok: false,
			message:
				"freshness.status must be one of current, stale, superseded, retracted",
		};
	}
	const changedAt = input.changedAt
		? normalizeIsoTimestamp(input.changedAt)
		: undefined;
	if (input.changedAt && !changedAt) {
		return { ok: false, message: "freshness.changedAt must be ISO 8601" };
	}
	if (status !== "current" && !changedAt) {
		return {
			ok: false,
			message: "freshness.changedAt is required for stale records",
		};
	}
	return {
		ok: true,
		value: {
			status,
			...(changedAt && { changedAt }),
			...(clean(input.note) && { note: clean(input.note) }),
			...(clean(input.replacementId) && {
				replacementId: clean(input.replacementId),
			}),
		},
	};
}

function validateLocator(
	kind: WorkMemorySourceKind,
	locator: {
		sourceId?: string;
		sourcePath?: string;
		sourceUrl?: string;
		sourceTool?: string;
	},
): string | null {
	switch (kind) {
		case "run":
			return locator.sourceId ? null : "run provenance requires sourceId";
		case "session":
			return locator.sourceId ? null : "session provenance requires sourceId";
		case "file":
			return locator.sourcePath ? null : "file provenance requires sourcePath";
		case "url":
			return locator.sourceUrl ? null : "url provenance requires sourceUrl";
		case "tool":
			return locator.sourceTool || locator.sourceId
				? null
				: "tool provenance requires sourceTool or sourceId";
		case "manual":
			return null;
	}
}

function normalizeIsoTimestamp(value: string): string | null {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString();
}

function normalizePublicHttpUrl(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		if (url.username || url.password) return null;
		return url.toString();
	} catch {
		return null;
	}
}

function clean(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function everyFieldMissing(
	input: WorkMemoryProvenanceInput | WorkMemoryFreshnessInput,
): boolean {
	for (const value of Object.values(input)) {
		if (clean(value) !== undefined) return false;
	}
	return true;
}
