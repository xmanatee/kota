/**
 * ModuleLogStore — persistent, queryable log storage for modules.
 *
 * Each module gets a JSONL log file at `.kota/modules/<name>/logs.jsonl`.
 * Enables observability of autonomous module operations: scheduled actions,
 * event handlers, scripts, and module lifecycle.
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
	module: string;
	msg: string;
	data?: unknown;
};

export type LogQueryOptions = {
	module?: string;
	level?: LogLevel;
	since?: string;
	keyword?: string;
	limit?: number;
};

const MAX_ENTRIES = 1000;
const PRUNE_TO = 750;

export class ModuleLogStore {
	private baseDir: string;

	constructor(baseDir: string) {
		this.baseDir = join(baseDir, ".kota", "modules");
	}

	append(module: string, level: LogLevel, msg: string, data?: unknown): void {
		const dir = join(this.baseDir, module);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const entry: LogEntry = {
			ts: new Date().toISOString(),
			level,
			module,
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

		if (opts.module) {
			entries = this.readLog(opts.module);
		} else {
			entries = [];
			for (const mod of this.modules()) {
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

	tail(module: string, count = 20): LogEntry[] {
		const entries = this.readLog(module);
		return entries.slice(-count);
	}

	modules(): string[] {
		if (!existsSync(this.baseDir)) return [];
		return readdirSync(this.baseDir).filter((d) =>
			existsSync(join(this.baseDir, d, "logs.jsonl")),
		);
	}

	clear(module: string): boolean {
		const path = join(this.baseDir, module, "logs.jsonl");
		if (!existsSync(path)) return false;
		unlinkSync(path);
		return true;
	}

	private readLog(module: string): LogEntry[] {
		const path = join(this.baseDir, module, "logs.jsonl");
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

let _store: ModuleLogStore | null = null;

export function initModuleLogStore(baseDir: string): ModuleLogStore {
	_store = new ModuleLogStore(baseDir);
	return _store;
}

export function getModuleLogStore(): ModuleLogStore | null {
	return _store;
}

export function resetModuleLogStore(): void {
	_store = null;
}
