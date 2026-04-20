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
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	KnowledgeEntry,
	ReindexResult,
	SearchFilters,
} from "#core/modules/provider-types.js";
import {
	applyFilters,
	findFileByIdInDir,
	listMdFiles,
	parseFrontMatter,
	parseKnowledgeFile,
	serializeFrontMatter,
	toSlug,
} from "./store-helpers.js";

export class KnowledgeStore {
	private projectDir: string | null;
	private globalDir: string;

	constructor(projectDir?: string, globalDir?: string) {
		this.projectDir = projectDir
			? join(projectDir, ".kota", "data")
			: null;
		this.globalDir = globalDir || join(homedir(), ".kota", "data");
	}

	/** Return the absolute directory path where the entry is stored, or null. */
	entryDir(id: string): string | null {
		for (const dir of this.allDirs()) {
			if (findFileByIdInDir(dir, id)) return dir;
		}
		return null;
	}

	/** Get the project storage directory, or null if none was configured. */
	getProjectDir(): string | null {
		return this.projectDir;
	}

	/** Get the global storage directory. */
	getGlobalDir(): string {
		return this.globalDir;
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
			for (const file of listMdFiles(dir)) {
				const entry = parseKnowledgeFile(dir, file);
				if (entry) entries.push(entry);
			}
		}
		return entries;
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
		const filename = `${toSlug(opts.title)}-${id}.md`;

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

		writeFileSync(join(dir, filename), serializeFrontMatter(attrs, opts.content), "utf-8");
		return id;
	}

	/** Read a single entry by ID. Searches both scopes. */
	read(id: string): KnowledgeEntry | null {
		for (const dir of this.allDirs()) {
			const file = findFileByIdInDir(dir, id);
			if (!file) continue;
			return parseKnowledgeFile(dir, file);
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
			const file = findFileByIdInDir(dir, id);
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

			const newBody = changes.content !== undefined ? changes.content : body;
			writeFileSync(join(dir, file), serializeFrontMatter(attrs, newBody), "utf-8");
			return true;
		}
		return false;
	}

	/** Delete an entry by ID. Returns true if found. */
	delete(id: string): boolean {
		for (const dir of this.allDirs()) {
			const file = findFileByIdInDir(dir, id);
			if (!file) continue;
			unlinkSync(join(dir, file));
			return true;
		}
		return false;
	}

	/** Search entries by keyword query and optional filters. */
	search(query: string, filters?: SearchFilters): KnowledgeEntry[] {
		const results = applyFilters(this.loadAll(filters?.scope), filters);

		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
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
		const results = applyFilters(this.loadAll(filters?.scope), filters);
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

	supportsSemanticSearch(): boolean {
		return false;
	}

	async semanticSearch(
		_query: string,
		_topK: number,
		_filters?: SearchFilters,
	): Promise<KnowledgeEntry[]> {
		throw new Error("Semantic knowledge search requires an embedding-backed knowledge provider.");
	}

	async reindex(): Promise<ReindexResult> {
		return { indexed: 0, failed: 0, skipped: true };
	}
}

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
