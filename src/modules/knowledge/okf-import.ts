import type { KnowledgeEntry } from "#core/modules/provider-types.js";
import {
	type OkfBundle,
	OkfBundleError,
	type OkfConcept,
	type OkfImportEntry,
	type OkfImportPlan,
	type OkfIssue,
	type OkfLossyMapping,
} from "./okf-types.js";

export function buildOkfImportPlan(
	bundle: OkfBundle,
	existingEntries: KnowledgeEntry[],
	options?: { status?: string },
): OkfImportPlan {
	const issues: OkfIssue[] = [];
	const existingConceptIds = new Set(
		existingEntries
			.map((entry) => entry.meta.okf_concept_id)
			.filter((id): id is string => typeof id === "string" && id.length > 0),
	);
	for (const concept of bundle.concepts) {
		if (existingConceptIds.has(concept.conceptId)) {
			issues.push({
				path: concept.relativePath,
				message: `OKF concept id "${concept.conceptId}" would collide with an existing knowledge entry`,
			});
		}
	}
	if (issues.length > 0) throw new OkfBundleError(issues);

	const entries: OkfImportEntry[] = [];
	const lossy: OkfLossyMapping[] = [];
	for (const concept of bundle.concepts) {
		const mapped = mapOkfConceptToKnowledgeEntry(concept, {
			status: options?.status ?? "active",
		});
		entries.push(mapped.entry);
		lossy.push(...mapped.lossy);
	}
	return { entries, lossy };
}

function mapOkfConceptToKnowledgeEntry(
	concept: OkfConcept,
	options: { status: string },
): { entry: OkfImportEntry; lossy: OkfLossyMapping[] } {
	const frontmatter = concept.frontmatter;
	const title =
		typeof frontmatter.title === "string" && frontmatter.title.trim()
			? frontmatter.title.trim()
			: titleFromConceptId(concept.conceptId);
	const type = typeof frontmatter.type === "string" ? frontmatter.type.trim() : "Reference";
	const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
	const meta: Record<string, string> = {
		okf_concept_id: concept.conceptId,
		okf_source_path: concept.relativePath,
	};
	if (concept.localLinks.length > 0) {
		meta.okf_links = concept.localLinks.join(",");
	}
	const lossy: OkfLossyMapping[] = [];
	const coreKeys = new Set(["type", "title", "tags"]);
	for (const [key, value] of Object.entries(frontmatter)) {
		if (coreKeys.has(key)) continue;
		if (typeof value === "string") {
			meta[key] = value;
		} else {
			lossy.push({
				conceptId: concept.conceptId,
				field: key,
				reason: "array metadata is not string-compatible with KOTA knowledge meta",
			});
		}
	}
	for (const field of concept.complexFields) {
		lossy.push({
			conceptId: concept.conceptId,
			field,
			reason: "object metadata is not string-compatible with KOTA knowledge meta",
		});
	}
	return {
		entry: {
			title,
			content: concept.body,
			type,
			tags,
			status: options.status,
			meta,
		},
		lossy,
	};
}

function titleFromConceptId(conceptId: string): string {
	const leaf = conceptId.split("/").at(-1) ?? conceptId;
	const title = leaf.replace(/[-_]+/g, " ").trim();
	return title || conceptId;
}
