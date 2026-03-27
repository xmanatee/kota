/**
 * ExtensionLogStore — persistent, queryable log storage for extensions.
 *
 * Each extension gets a JSONL log file at `.kota/extensions/<name>/logs.jsonl`.
 * Enables observability of autonomous extension operations: scheduled actions,
 * event handlers, scripts, and extension lifecycle.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,readdirSync, 
	readFileSync,
	unlinkSync,
	writeFileSync
} from "node:fs";
import { join } from "node:path";

export type LogLevel = "info" | "warn" | "error" | "debug";

export type LogEntry = {
	ts: string;
	level: LogLevel;
	extension: string;
	msg: string;
	data?: unknown;
};

export type LogQueryOptions = {
	extension?: string;
	level?: LogLevel;
	since?: string;
	keyword?: string;
	limit?: number;
};

const MAX_ENTRIES = 1000;
const PRUNE_TO = 750;

export class ExtensionLogStore {
	private baseDir: string;

	constructor(baseDir: string) {
		this.baseDir = join(baseDir, ".kota", "extensions");
	}

	append(extension: string, level: LogLevel, msg: string, data?: unknown): void {
		const dir = join(this.baseDir, extension);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const entry: LogEntry = {
			ts: new Date().toISOString(),
			level,
			extension,
			msg,
		};
		if (data !== undefined) entry.data = data;
		const path = join(dir, "logs.jsonl");
		appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8");
		this.maybePrune(path);
	}

	query(opts: LogQueryOptions = {}): LogEntry[] {
		const limit = opts.limit ?? 50;
		let entries: LogEntry[];

		if (opts.extension) {
			entries = this.readLog(opts.extension);
		} else {
			entries = [];
			for (const mod of this.extensions()) {
				entries.push(...this.readLog(mod));
			}
		}

		if (opts.level) {
			entries = entries.filter((e) => e.level === opts.level);
		}
		if (opts.since) {
			const sinceMs = new Date(opts.since).getTime();
			entries = entries.filter((e) => new Date(e.ts).getTime() >= sinceMs);
		}
		if (opts.keyword) {
			const kw = opts.keyword.toLowerCase();
			entries = entries.filter(
				(e) =>
					e.msg.toLowerCase().includes(kw) ||
					(e.data && JSON.stringify(e.data).toLowerCase().includes(kw)),
			);
		}

		entries.sort((a, b) => b.ts.localeCompare(a.ts));
		return entries.slice(0, limit);
	}

	tail(extension: string, count = 20): LogEntry[] {
		const entries = this.readLog(extension);
		return entries.slice(-count);
	}

	extensions(): string[] {
		if (!existsSync(this.baseDir)) return [];
		return readdirSync(this.baseDir).filter((d) =>
			existsSync(join(this.baseDir, d, "logs.jsonl")),
		);
	}

	clear(extension: string): boolean {
		const path = join(this.baseDir, extension, "logs.jsonl");
		if (!existsSync(path)) return false;
		unlinkSync(path);
		return true;
	}

	private readLog(extension: string): LogEntry[] {
		const path = join(this.baseDir, extension, "logs.jsonl");
		if (!existsSync(path)) return [];
		try {
			const content = readFileSync(path, "utf-8");
			return content
				.split("\n")
				.filter(Boolean)
				.map((line) => {
					try {
						return JSON.parse(line) as LogEntry;
					} catch {
						return null;
					}
				})
				.filter((e): e is LogEntry => e !== null);
		} catch {
			return [];
		}
	}

	private maybePrune(path: string): void {
		try {
			const content = readFileSync(path, "utf-8");
			const lines = content.split("\n").filter(Boolean);
			if (lines.length > MAX_ENTRIES) {
				const pruned = lines.slice(-PRUNE_TO);
				writeFileSync(path, `${pruned.join("\n")}\n`, "utf-8");
			}
		} catch {}
	}
}

// ─── Singleton ────────────────────────────────────────────────────────

let _store: ExtensionLogStore | null = null;

export function initExtensionLogStore(baseDir: string): ExtensionLogStore {
	_store = new ExtensionLogStore(baseDir);
	return _store;
}

export function getExtensionLogStore(): ExtensionLogStore | null {
	return _store;
}

export function resetExtensionLogStore(): void {
	_store = null;
}
