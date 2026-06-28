import {
	existsSync,
	mkdirSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { KnowledgeEntry } from "#core/modules/provider-types.js";
import { isFlatFrontMatterKey } from "#core/util/frontmatter.js";
import {
	isPathInside,
	isSafeConceptId,
} from "./okf-paths.js";
import {
	OKF_VERSION,
	OkfBundleError,
	type OkfExportResult,
	type OkfLossyMapping,
} from "./okf-types.js";
import { serializeFrontMatter, toSlug } from "./store-helpers.js";

export function exportOkfBundle(options: {
	outputDir: string;
	entries: KnowledgeEntry[];
}): OkfExportResult {
	const outputDir = resolve(options.outputDir);
	assertSupportedOutputDir(outputDir);
	mkdirSync(outputDir, { recursive: true });

	const paths: string[] = [];
	const lossy: OkfLossyMapping[] = [];
	const seenConceptIds = new Map<string, string>();
	const indexEntries: { title: string; path: string; description: string }[] = [];

	for (const entry of options.entries) {
		const conceptId = exportConceptId(entry);
		const collision = seenConceptIds.get(conceptId.toLowerCase());
		if (collision) {
			throw new OkfBundleError([
				{
					path: conceptId,
					message: `export concept id collides with entry "${collision}"`,
				},
			]);
		}
		seenConceptIds.set(conceptId.toLowerCase(), entry.id);
		const relativePath = `${conceptId}.md`;
		const absolutePath = safeJoinOutputPath(outputDir, relativePath);
		mkdirSync(dirname(absolutePath), { recursive: true });
		const serialized = serializeOkfConcept(entry, lossy);
		writeFileSync(absolutePath, serialized, "utf-8");
		paths.push(relativePath);
		indexEntries.push({
			title: entry.title,
			path: relativePath,
			description: entry.meta.description ?? "",
		});
	}

	writeFileSync(
		join(outputDir, "index.md"),
		serializeRootIndex(indexEntries),
		"utf-8",
	);
	return { count: options.entries.length, paths, lossy };
}

function serializeOkfConcept(
	entry: KnowledgeEntry,
	lossy: OkfLossyMapping[],
): string {
	const attrs: Record<string, string | string[]> = {
		type: entry.type || "Reference",
		title: entry.title,
	};
	const description = entry.meta.description;
	if (description) attrs.description = description;
	const resource = entry.meta.resource;
	if (resource) attrs.resource = resource;
	if (entry.tags.length > 0) attrs.tags = entry.tags;
	attrs.timestamp = entry.meta.timestamp ?? entry.updated;

	const reservedKeys = new Set([
		"description",
		"resource",
		"timestamp",
		"okf_concept_id",
		"okf_source_path",
		"okf_links",
	]);
	for (const [key, value] of Object.entries(entry.meta)) {
		if (reservedKeys.has(key)) continue;
		if (isFlatFrontMatterKey(key)) {
			attrs[key] = value;
		} else {
			lossy.push({
				conceptId: entry.meta.okf_concept_id ?? entry.id,
				field: key,
				reason: "metadata key is not supported in OKF frontmatter",
			});
		}
	}
	return serializeFrontMatter(attrs, entry.content);
}

function serializeRootIndex(
	entries: { title: string; path: string; description: string }[],
): string {
	const lines = [
		"---",
		`okf_version: "${OKF_VERSION}"`,
		"---",
		"# Concepts",
		"",
	];
	for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
		const suffix = entry.description ? ` - ${entry.description}` : "";
		lines.push(`* [${entry.title}](${entry.path})${suffix}`);
	}
	lines.push("");
	return lines.join("\n");
}

function exportConceptId(entry: KnowledgeEntry): string {
	const fromMeta = entry.meta.okf_concept_id?.trim();
	const conceptId = fromMeta
		? stripMarkdownExtension(fromMeta)
		: toSlug(`${entry.title}-${entry.id}`) || entry.id;
	if (!isSafeConceptId(conceptId)) {
		throw new OkfBundleError([
			{
				path: entry.id,
				message: `unsupported OKF output concept id "${conceptId}"`,
			},
		]);
	}
	return conceptId;
}

function stripMarkdownExtension(value: string): string {
	return value.endsWith(".md") ? value.slice(0, -3) : value;
}

function assertSupportedOutputDir(outputDir: string): void {
	if (!existsSync(outputDir)) return;
	const stat = statSync(outputDir);
	if (!stat.isDirectory()) {
		throw new OkfBundleError([
			{ path: outputDir, message: "output path is not a directory" },
		]);
	}
	const entries = readdirSync(outputDir).filter((name) => name !== ".DS_Store");
	if (entries.length > 0) {
		throw new OkfBundleError([
			{ path: outputDir, message: "output directory must be empty" },
		]);
	}
}

function safeJoinOutputPath(root: string, relativePath: string): string {
	const absolutePath = resolve(root, relativePath);
	if (!isPathInside(root, absolutePath)) {
		throw new OkfBundleError([
			{ path: relativePath, message: "output path escapes bundle root" },
		]);
	}
	return absolutePath;
}
