import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	parseFlatFrontMatter,
	serializeFlatFrontMatter,
} from "#core/util/frontmatter.js";

export type KnowledgeEntry = {
	id: string;
	title: string;
	type: string;
	tags: string[];
	status: string;
	created: string;
	updated: string;
	content: string;
	/** Extra metadata fields not covered by the core schema. */
	meta: Record<string, string>;
};

export type SearchFilters = {
	type?: string;
	tag?: string;
	status?: string;
	since?: string;
	scope?: "project" | "global" | "all";
};

/** Parse a YAML front matter block into a flat key-value map. */
export function parseFrontMatter(raw: string): {
	attrs: Record<string, string | string[]>;
	body: string;
} {
	return parseFlatFrontMatter(raw);
}

/** Serialize attributes + body into a markdown file with YAML front matter. */
export function serializeFrontMatter(
	attrs: Record<string, string | string[]>,
	body: string,
): string {
	return serializeFlatFrontMatter(attrs, body);
}

/** Convert a title into a filesystem-safe slug. */
export function toSlug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

/** Apply metadata filters to a list of entries. */
export function applyFilters(
	entries: KnowledgeEntry[],
	filters: SearchFilters | undefined,
): KnowledgeEntry[] {
	if (!filters) return entries;
	let results = entries;

	if (filters.type) {
		const t = filters.type.toLowerCase();
		results = results.filter((e) => e.type.toLowerCase() === t);
	}
	if (filters.tag) {
		const tag = filters.tag.toLowerCase();
		results = results.filter((e) =>
			e.tags.some((t) => t.toLowerCase() === tag),
		);
	}
	if (filters.status) {
		const s = filters.status.toLowerCase();
		results = results.filter((e) => e.status.toLowerCase() === s);
	}
	if (filters.since) {
		const sinceMs = new Date(filters.since).getTime();
		if (!Number.isNaN(sinceMs)) {
			results = results.filter(
				(e) => new Date(e.created).getTime() >= sinceMs,
			);
		}
	}
	return results;
}

/** List .md files in a directory. */
export function listMdFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((f) => f.endsWith(".md"));
}

const CORE_KEYS = new Set([
	"id",
	"title",
	"type",
	"tags",
	"status",
	"created",
	"updated",
]);

/** Parse a knowledge entry from a markdown file. Returns null on failure. */
export function parseKnowledgeFile(
	dir: string,
	file: string,
): KnowledgeEntry | null {
	try {
		const raw = readFileSync(join(dir, file), "utf-8");
		const { attrs, body } = parseFrontMatter(raw);
		const id = typeof attrs.id === "string" ? attrs.id : "";
		if (!id) return null;

		const meta: Record<string, string> = {};
		for (const [k, v] of Object.entries(attrs)) {
			if (!CORE_KEYS.has(k) && typeof v === "string") {
				meta[k] = v;
			}
		}

		return {
			id,
			title: typeof attrs.title === "string" ? attrs.title : "",
			type: typeof attrs.type === "string" ? attrs.type : "note",
			tags: Array.isArray(attrs.tags) ? attrs.tags : [],
			status: typeof attrs.status === "string" ? attrs.status : "active",
			created: typeof attrs.created === "string" ? attrs.created : "",
			updated: typeof attrs.updated === "string" ? attrs.updated : "",
			content: body,
			meta,
		};
	} catch {
		return null;
	}
}

/** Find a filename in a directory by entry ID. Returns null if not found. */
export function findFileByIdInDir(dir: string, id: string): string | null {
	const suffix = `-${id}.md`;
	const files = listMdFiles(dir);
	for (const file of files) {
		if (file.endsWith(suffix)) return file;
	}
	for (const file of files) {
		const entry = parseKnowledgeFile(dir, file);
		if (entry?.id === id) return file;
	}
	return null;
}
