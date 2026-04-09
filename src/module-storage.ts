/**
 * ModuleStorage — scoped file-based storage for modules.
 *
 * Each module gets its own isolated directory under `.kota/modules/<name>/`.
 * Supports JSON objects, raw text, and markdown files.
 * This enables truly self-contained modules that own their data.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export class ModuleStorage {
	private dir: string;

	constructor(baseDir: string, moduleName: string) {
		this.dir = join(baseDir, ".kota", "modules", moduleName);
	}

	/** Get the storage directory path (creates it lazily on first write). */
	getDir(): string {
		return this.dir;
	}

	/** Read a JSON value by key. Returns undefined if not found. */
	getJSON<T = unknown>(key: string): T | undefined {
		const path = this.resolvePath(key, ".json");
		if (!existsSync(path)) return undefined;
		try {
			return JSON.parse(readFileSync(path, "utf-8")) as T;
		} catch {
			return undefined;
		}
	}

	/** Write a JSON value by key. */
	setJSON(key: string, value: unknown): void {
		this.ensureDir();
		const path = this.resolvePath(key, ".json");
		writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
	}

	/** Read raw text by key. Returns undefined if not found. */
	getText(key: string): string | undefined {
		const path = this.resolvePath(key, ".txt");
		if (!existsSync(path)) return undefined;
		try {
			return readFileSync(path, "utf-8");
		} catch {
			return undefined;
		}
	}

	/** Write raw text by key. */
	setText(key: string, value: string): void {
		this.ensureDir();
		const path = this.resolvePath(key, ".txt");
		writeFileSync(path, value, "utf-8");
	}

	/** Read a file by exact filename (for markdown, etc.). */
	readFile(filename: string): string | undefined {
		const path = join(this.dir, filename);
		if (!existsSync(path)) return undefined;
		try {
			return readFileSync(path, "utf-8");
		} catch {
			return undefined;
		}
	}

	/** Write a file by exact filename. */
	writeFile(filename: string, content: string): void {
		this.ensureDir();
		writeFileSync(join(this.dir, filename), content, "utf-8");
	}

	/** Check if a key exists (checks all modules). */
	has(key: string): boolean {
		return (
			existsSync(this.resolvePath(key, ".json")) ||
			existsSync(this.resolvePath(key, ".txt"))
		);
	}

	/** Check if a file exists by exact filename. */
	hasFile(filename: string): boolean {
		return existsSync(join(this.dir, filename));
	}

	/** Delete a key (removes all modules). Returns true if anything was deleted. */
	delete(key: string): boolean {
		let deleted = false;
		for (const ext of [".json", ".txt"]) {
			const path = this.resolvePath(key, ext);
			if (existsSync(path)) {
				unlinkSync(path);
				deleted = true;
			}
		}
		return deleted;
	}

	/** Delete a file by exact filename. */
	deleteFile(filename: string): boolean {
		const path = join(this.dir, filename);
		if (!existsSync(path)) return false;
		unlinkSync(path);
		return true;
	}

	/** List all files in storage. */
	list(): string[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir).sort();
	}

	/** List files matching a glob-like suffix (e.g. ".json", ".md"). */
	listByExtension(ext: string): string[] {
		return this.list().filter((f) => f.endsWith(ext));
	}

	/** Remove all files in this module's storage. */
	clear(): void {
		if (!existsSync(this.dir)) return;
		for (const file of readdirSync(this.dir)) {
			unlinkSync(join(this.dir, file));
		}
	}

	private ensureDir(): void {
		if (!existsSync(this.dir)) {
			mkdirSync(this.dir, { recursive: true });
		}
	}

	private resolvePath(key: string, ext: string): string {
		const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
		return join(this.dir, `${safeKey}${ext}`);
	}
}
