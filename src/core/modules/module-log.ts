/**
 * ModuleLogStore — persistent, queryable log storage for modules.
 *
 * Each module gets a JSONL log file at `.kota/modules/<name>/logs.jsonl`.
 * Enables observability of autonomous module operations: scheduled actions,
 * event handlers, scripts, and module lifecycle.
 */

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { appendAnchoredTextFile, readAnchoredTextFile, writeAnchoredTextFile } from "#core/util/filesystem/anchored-files.js";
import { assertModuleStorageName, listModuleDirectories, moduleFile } from "./module-files.js";
import { ModuleStorage } from "./module-storage.js";

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
	private readonly baseDir: string;

	constructor(baseDir: string) {
		this.baseDir = resolve(baseDir);
	}

	append(module: string, level: LogLevel, msg: string, data?: unknown): void {
    const access = moduleFile(this.baseDir, module, "logs.jsonl");
		const entry: LogEntry = {
			ts: new Date().toISOString(),
			level,
			module,
			msg,
		};
		if (data !== undefined) entry.data = data;
    appendAnchoredTextFile({ ...access, content: `${JSON.stringify(entry)}\n` });
    this.maybePrune(module);
	}

	query(opts: LogQueryOptions = {}): LogEntry[] {
		const limit = opts.limit ?? 50;
		let entries: LogEntry[];

		if (opts.module !== undefined) {
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
    return listModuleDirectories(this.baseDir).filter(module =>
      new ModuleStorage(this.baseDir, module).hasFile("logs.jsonl"));
  }

  clear(module: string): boolean {
    return new ModuleStorage(this.baseDir, module).deleteFile("logs.jsonl");
  }

  private readLog(module: string): LogEntry[] {
    const content = new ModuleStorage(this.baseDir, module).readFile("logs.jsonl");
    if (content === undefined) return [];
    return content.split("\n").filter(Boolean).map(line => decodeModuleLogLine(line, module));
  }

  private maybePrune(module: string): void {
    const access = moduleFile(this.baseDir, module, "logs.jsonl");
    const file = readAnchoredTextFile(access);
    if (file === null) throw new Error(`Module log disappeared before pruning: ${module}`);
    const lines = file.content.split("\n").filter(Boolean);
    // Never discard malformed history during retention. It needs explicit repair.
    for (const line of lines) decodeModuleLogLine(line, module);
    if (lines.length > MAX_ENTRIES) {
      writeAnchoredTextFile({ ...access, expectation: "existing", expectedSnapshot: file.snapshot,
        content: `${lines.slice(-PRUNE_TO).join("\n")}\n` });
    }
  }
}

export function decodeModuleLogLine(line: string, module: string): LogEntry {
  let entry: unknown;
  try { entry = JSON.parse(line); }
  catch { throw new Error(`Invalid module log JSON for ${module}`); }
  if (typeof entry !== "object" || entry === null ||
    !("ts" in entry) || typeof entry.ts !== "string" ||
    !("msg" in entry) || typeof entry.msg !== "string" ||
    !("module" in entry) || entry.module !== module ||
    !("level" in entry) || (entry.level !== "info" && entry.level !== "warn" && entry.level !== "error" && entry.level !== "debug")) {
    throw new Error(`Invalid module log entry for ${module}`);
  }
  return { ts: entry.ts, msg: entry.msg, module: entry.module, level: entry.level,
    ...("data" in entry ? { data: entry.data } : {}) };
}

/** Content identity survives retention moving the record to a different line. */
export function moduleLogRecordReference(module: string, line: string): string {
  assertModuleStorageName(module);
  return `.kota/modules/${module}/logs.jsonl#sha256=${moduleLogRecordDigest(line)}`;
}

export function moduleLogRecordDigest(line: string): string {
  return createHash("sha256").update(line).digest("hex");
}
