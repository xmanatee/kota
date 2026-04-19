/**
 * SQLite-backed memory provider — alternative to the file-based MemoryStore.
 *
 * Uses the `sqlite3` CLI (same approach as src/core/tools/sqlite.ts) so no library
 * dependency is needed. Stores memories in `.kota/memory.db`.
 *
 * Advantages over file-based:
 * - SQL-powered search (LIKE, date ranges, tag filtering)
 * - No full-file reads on every operation
 * - Scales beyond 100 memories without pruning
 * - Concurrent access via SQLite WAL mode
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Memory } from "#core/memory/store.js";
import type { MemoryProvider, ReindexResult } from "#core/modules/provider-types.js";

const TIMEOUT_MS = 10_000;
const MAX_BUFFER = 5 * 1024 * 1024;

function execSql(dbPath: string, sql: string): string {
	try {
		return execFileSync("sqlite3", ["-json", dbPath, sql], {
			timeout: TIMEOUT_MS,
			maxBuffer: MAX_BUFFER,
			stdio: ["pipe", "pipe", "pipe"],
		})
			.toString("utf-8")
			.trim();
	} catch (e) {
		const nodeErr = e as NodeJS.ErrnoException & { stderr?: Buffer };
		if (nodeErr.code === "ENOENT") {
			throw new Error("sqlite3 CLI not found — install sqlite3 to use the SQLite memory provider");
		}
		const stderr = nodeErr.stderr?.toString("utf-8")?.trim() || "";
		throw new Error(stderr || (e instanceof Error ? e.message : String(e)));
	}
}

function execSqlVoid(dbPath: string, sql: string): void {
	try {
		execFileSync("sqlite3", [dbPath, sql], {
			timeout: TIMEOUT_MS,
			maxBuffer: MAX_BUFFER,
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (e) {
		const nodeErr = e as NodeJS.ErrnoException & { stderr?: Buffer };
		if (nodeErr.code === "ENOENT") {
			throw new Error("sqlite3 CLI not found — install sqlite3 to use the SQLite memory provider");
		}
		const stderr = nodeErr.stderr?.toString("utf-8")?.trim() || "";
		throw new Error(stderr || (e instanceof Error ? e.message : String(e)));
	}
}

/** Escape a string for use in SQL single-quoted literals. */
function esc(s: string): string {
	return s.replace(/'/g, "''");
}

export class SQLiteMemoryProvider implements MemoryProvider {
	private dbPath: string;
	private initialized = false;

	constructor(baseDir: string) {
		this.dbPath = join(baseDir, "memory.db");
	}

	private ensureInit(): void {
		if (this.initialized) return;
		const dir = dirname(this.dbPath);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		execSqlVoid(
			this.dbPath,
			`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created);`,
		);
		this.initialized = true;
	}

	save(content: string, tags: string[] = []): string {
		this.ensureInit();
		const id = randomBytes(4).toString("hex");
		const created = new Date().toISOString();
		const tagsJson = JSON.stringify(tags);
		execSqlVoid(
			this.dbPath,
			`INSERT INTO memories (id, content, tags, created) VALUES ('${esc(id)}', '${esc(content)}', '${esc(tagsJson)}', '${esc(created)}');`,
		);
		return id;
	}

	search(query: string, options?: { tag?: string; since?: string }): Memory[] {
		this.ensureInit();
		const conditions: string[] = [];

		const terms = query
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean);
		for (const term of terms) {
			conditions.push(`(LOWER(content) LIKE '%${esc(term)}%' OR LOWER(tags) LIKE '%${esc(term)}%')`);
		}

		if (options?.tag) {
			conditions.push(`LOWER(tags) LIKE '%"${esc(options.tag.toLowerCase())}"%'`);
		}
		if (options?.since) {
			const sinceDate = new Date(options.since);
			if (!Number.isNaN(sinceDate.getTime())) {
				conditions.push(`created >= '${esc(sinceDate.toISOString())}'`);
			}
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const sql = `SELECT id, content, tags, created FROM memories ${where} ORDER BY created DESC;`;

		const raw = execSql(this.dbPath, sql);
		if (!raw) return [];
		return this.parseRows(raw);
	}

	list(): Memory[] {
		this.ensureInit();
		const raw = execSql(this.dbPath, "SELECT id, content, tags, created FROM memories ORDER BY created DESC;");
		if (!raw) return [];
		return this.parseRows(raw);
	}

	update(id: string, updates: { content?: string; tags?: string[] }): boolean {
		this.ensureInit();
		const sets: string[] = [];
		if (updates.content !== undefined) {
			sets.push(`content = '${esc(updates.content)}'`);
		}
		if (updates.tags !== undefined) {
			sets.push(`tags = '${esc(JSON.stringify(updates.tags))}'`);
		}
		if (sets.length === 0) return false;

		execSqlVoid(this.dbPath, `UPDATE memories SET ${sets.join(", ")} WHERE id = '${esc(id)}';`);
		return this.rowExists(id);
	}

	delete(id: string): boolean {
		this.ensureInit();
		const exists = this.rowExists(id);
		if (!exists) return false;
		execSqlVoid(this.dbPath, `DELETE FROM memories WHERE id = '${esc(id)}';`);
		return true;
	}

	private rowExists(id: string): boolean {
		const raw = execSql(this.dbPath, `SELECT COUNT(*) as cnt FROM memories WHERE id = '${esc(id)}';`);
		if (!raw) return false;
		const rows = JSON.parse(raw) as { cnt: number }[];
		return rows.length > 0 && rows[0].cnt > 0;
	}

	private parseRows(raw: string): Memory[] {
		const rows = JSON.parse(raw) as { id: string; content: string; tags: string; created: string }[];
		return rows.map((r) => ({
			id: r.id,
			content: r.content,
			tags: JSON.parse(r.tags) as string[],
			created: r.created,
		}));
	}

	supportsSemanticSearch(): boolean {
		return false;
	}

	async semanticSearch(
		_query: string,
		_topK: number,
		_options?: { tag?: string; since?: string },
	): Promise<Memory[]> {
		throw new Error("Semantic memory search requires an embedding-backed memory provider.");
	}

	async reindex(): Promise<ReindexResult> {
		return { indexed: 0, failed: 0, skipped: true };
	}

	/** Get the database file path (for testing/diagnostics). */
	getDbPath(): string {
		return this.dbPath;
	}
}
