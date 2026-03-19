/**
 * Knowledge Store — file-based data layer using markdown + YAML front matter.
 *
 * Each entry is a markdown file:
 *   ---
 *   id: abc123
 *   title: My Note
 *   type: note
 *   tags: [research, api]
 *   status: active
 *   created: 2024-03-15T10:00:00Z
 *   updated: 2024-03-15T10:00:00Z
 *   ---
 *   # Content here
 *
 * Supports project-scoped (.kota/data/) and global (~/.kota/data/) storage.
 */

import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	parseFlatFrontMatter,
	serializeFlatFrontMatter,
} from "../frontmatter.js";

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

// --- YAML front matter parser/serializer (minimal, no deps) ---

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

// --- Slug generation ---

/** Convert a title into a filesystem-safe slug. */
export function toSlug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

// --- KnowledgeStore ---

export class KnowledgeStore {
	private projectDir: string | null;
	private globalDir: string;

	constructor(projectDir?: string, globalDir?: string) {
		this.projectDir = projectDir
			? join(projectDir, ".kota", "data")
			: null;
		this.globalDir = globalDir || join(homedir(), ".kota", "data");
	}

	private ensureDir(dir: string): void {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	}

	private getDir(scope: "project" | "global"): string {
		if (scope === "project") {
			if (!this.projectDir) {
				throw new Error("No project directory configured");
			}
			return this.projectDir;
		}
		return this.globalDir;
	}

	/** Create a new knowledge entry. Returns the entry ID. */
	create(opts: {
		title: string;
		content: string;
		type?: string;
		tags?: string[];
		status?: string;
		scope?: "project" | "global";
		meta?: Record<string, string>;
	}): string {
		const scope = opts.scope || "project";
		const dir = this.getDir(scope);
		this.ensureDir(dir);

		const id = randomBytes(4).toString("hex");
		const now = new Date().toISOString();
		const slug = toSlug(opts.title);
		const filename = `${slug}-${id}.md`;

		const attrs: Record<string, string | string[]> = {
			id,
			title: opts.title,
			type: opts.type || "note",
			tags: opts.tags || [],
			status: opts.status || "active",
			created: now,
			updated: now,
			...(opts.meta || {}),
		};

		const data = serializeFrontMatter(attrs, opts.content);
		writeFileSync(join(dir, filename), data, "utf-8");
		return id;
	}

	/** Read a single entry by ID. Searches both scopes. */
	read(id: string): KnowledgeEntry | null {
		for (const dir of this.allDirs()) {
			const entry = this.findInDir(dir, id);
			if (entry) return entry;
		}
		return null;
	}

	/** Update an existing entry. Returns true if found. */
	update(
		id: string,
		changes: {
			title?: string;
			content?: string;
			type?: string;
			tags?: string[];
			status?: string;
			meta?: Record<string, string>;
		},
	): boolean {
		for (const dir of this.allDirs()) {
			const file = this.findFileInDir(dir, id);
			if (!file) continue;

			const raw = readFileSync(join(dir, file), "utf-8");
			const { attrs, body } = parseFrontMatter(raw);

			if (changes.title !== undefined) attrs.title = changes.title;
			if (changes.type !== undefined) attrs.type = changes.type;
			if (changes.tags !== undefined) attrs.tags = changes.tags;
			if (changes.status !== undefined) attrs.status = changes.status;
			if (changes.meta) {
				for (const [k, v] of Object.entries(changes.meta)) {
					attrs[k] = v;
				}
			}
			attrs.updated = new Date().toISOString();

			const newBody =
				changes.content !== undefined ? changes.content : body;
			const data = serializeFrontMatter(attrs, newBody);
			writeFileSync(join(dir, file), data, "utf-8");
			return true;
		}
		return false;
	}

	/** Delete an entry by ID. Returns true if found. */
	delete(id: string): boolean {
		for (const dir of this.allDirs()) {
			const file = this.findFileInDir(dir, id);
			if (!file) continue;
			unlinkSync(join(dir, file));
			return true;
		}
		return false;
	}

	/** Search entries by keyword query and optional filters. */
	search(query: string, filters?: SearchFilters): KnowledgeEntry[] {
		const entries = this.loadAll(filters?.scope);
		let results = entries;

		// Apply metadata filters
		if (filters?.type) {
			const t = filters.type.toLowerCase();
			results = results.filter((e) => e.type.toLowerCase() === t);
		}
		if (filters?.tag) {
			const tag = filters.tag.toLowerCase();
			results = results.filter((e) =>
				e.tags.some((t) => t.toLowerCase() === tag),
			);
		}
		if (filters?.status) {
			const s = filters.status.toLowerCase();
			results = results.filter((e) => e.status.toLowerCase() === s);
		}
		if (filters?.since) {
			const sinceMs = new Date(filters.since).getTime();
			if (!Number.isNaN(sinceMs)) {
				results = results.filter(
					(e) => new Date(e.created).getTime() >= sinceMs,
				);
			}
		}

		// Keyword search: rank by term match count
		const terms = query
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean);
		if (terms.length === 0) return results;

		return results
			.map((e) => {
				const text =
					`${e.title} ${e.content} ${e.tags.join(" ")} ${e.type}`.toLowerCase();
				const hits = terms.filter((t) => text.includes(t)).length;
				return { entry: e, score: hits / terms.length };
			})
			.filter((r) => r.score > 0)
			.sort((a, b) => b.score - a.score)
			.map((r) => r.entry);
	}

	/** List entries with optional filters. */
	list(filters?: SearchFilters): KnowledgeEntry[] {
		const entries = this.loadAll(filters?.scope);
		let results = entries;

		if (filters?.type) {
			const t = filters.type.toLowerCase();
			results = results.filter((e) => e.type.toLowerCase() === t);
		}
		if (filters?.tag) {
			const tag = filters.tag.toLowerCase();
			results = results.filter((e) =>
				e.tags.some((t) => t.toLowerCase() === tag),
			);
		}
		if (filters?.status) {
			const s = filters.status.toLowerCase();
			results = results.filter((e) => e.status.toLowerCase() === s);
		}
		if (filters?.since) {
			const sinceMs = new Date(filters.since).getTime();
			if (!Number.isNaN(sinceMs)) {
				results = results.filter(
					(e) => new Date(e.created).getTime() >= sinceMs,
				);
			}
		}

		// Sort newest first
		results.sort(
			(a, b) =>
				new Date(b.updated).getTime() - new Date(a.updated).getTime(),
		);
		return results;
	}

	/** Count entries, optionally filtered by type. */
	count(type?: string): number {
		const entries = this.loadAll();
		if (!type) return entries.length;
		const t = type.toLowerCase();
		return entries.filter((e) => e.type.toLowerCase() === t).length;
	}

	// --- Internal helpers ---

	private allDirs(): string[] {
		const dirs: string[] = [];
		if (this.projectDir && existsSync(this.projectDir))
			dirs.push(this.projectDir);
		if (existsSync(this.globalDir)) dirs.push(this.globalDir);
		return dirs;
	}

	private loadAll(scope?: "project" | "global" | "all"): KnowledgeEntry[] {
		const dirs: string[] = [];
		if (
			(!scope || scope === "project" || scope === "all") &&
			this.projectDir &&
			existsSync(this.projectDir)
		) {
			dirs.push(this.projectDir);
		}
		if (
			(!scope || scope === "global" || scope === "all") &&
			existsSync(this.globalDir)
		) {
			dirs.push(this.globalDir);
		}

		const entries: KnowledgeEntry[] = [];
		for (const dir of dirs) {
			for (const file of this.mdFiles(dir)) {
				const entry = this.parseFile(dir, file);
				if (entry) entries.push(entry);
			}
		}
		return entries;
	}

	private mdFiles(dir: string): string[] {
		if (!existsSync(dir)) return [];
		return readdirSync(dir).filter((f) => f.endsWith(".md"));
	}

	private findFileInDir(dir: string, id: string): string | null {
		// Match by filename convention: {slug}-{id}.md
		const suffix = `-${id}.md`;
		for (const file of this.mdFiles(dir)) {
			if (file.endsWith(suffix)) return file;
		}
		// Fallback: parse files to match by ID attribute
		for (const file of this.mdFiles(dir)) {
			const entry = this.parseFile(dir, file);
			if (entry?.id === id) return file;
		}
		return null;
	}

	private findInDir(dir: string, id: string): KnowledgeEntry | null {
		const file = this.findFileInDir(dir, id);
		if (!file) return null;
		return this.parseFile(dir, file);
	}

	private parseFile(dir: string, file: string): KnowledgeEntry | null {
		try {
			const raw = readFileSync(join(dir, file), "utf-8");
			const { attrs, body } = parseFrontMatter(raw);
			const id = typeof attrs.id === "string" ? attrs.id : "";
			if (!id) return null;

			const coreKeys = new Set([
				"id",
				"title",
				"type",
				"tags",
				"status",
				"created",
				"updated",
			]);
			const meta: Record<string, string> = {};
			for (const [k, v] of Object.entries(attrs)) {
				if (!coreKeys.has(k) && typeof v === "string") {
					meta[k] = v;
				}
			}

			return {
				id,
				title: typeof attrs.title === "string" ? attrs.title : "",
				type: typeof attrs.type === "string" ? attrs.type : "note",
				tags: Array.isArray(attrs.tags) ? attrs.tags : [],
				status:
					typeof attrs.status === "string" ? attrs.status : "active",
				created:
					typeof attrs.created === "string" ? attrs.created : "",
				updated:
					typeof attrs.updated === "string" ? attrs.updated : "",
				content: body,
				meta,
			};
		} catch {
			return null;
		}
	}
}

// --- Singleton ---

let store: KnowledgeStore | undefined;

export function getKnowledgeStore(cwd?: string): KnowledgeStore {
	if (!store) {
		store = new KnowledgeStore(cwd || process.cwd());
	}
	return store;
}

export function resetKnowledgeStore(): void {
	store = undefined;
}
