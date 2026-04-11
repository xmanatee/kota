import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { getEventBus } from "#core/events/event-bus.js";

export interface FileChange {
	path: string;
	type: "create" | "change" | "delete";
}

export interface WatcherInfo {
	id: string;
	path: string;
	recursive: boolean;
	modules: string[] | undefined;
	changeCount: number;
	createdAt: string;
}

export interface ActiveWatcher {
	id: string;
	rootPath: string;
	recursive: boolean;
	modules: string[] | undefined;
	fsWatchers: import("node:fs").FSWatcher[];
	watchedDirs: Set<string>;
	snapshot: Map<string, number>;
	pollTimer: ReturnType<typeof setInterval> | null;
	polling: boolean;
	pending: Map<string, FileChange>;
	timer: ReturnType<typeof setTimeout> | null;
	changeCount: number;
	createdAt: Date;
}

const DEFAULT_IGNORE = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"__pycache__",
	".cache",
	".turbo",
]);

export const DEBOUNCE_MS = 250;
export const MAX_WATCHERS = 10;
const WATCHER_SETTLE_MS = 50;
export const POLL_INTERVAL_MS = 500;

function getErrorCode(error: unknown): string | undefined {
	if (
		error &&
		typeof error === "object" &&
		"code" in error &&
		typeof (error as { code?: unknown }).code === "string"
	) {
		return (error as { code: string }).code;
	}
	return undefined;
}

export function isIgnorableFsRace(error: unknown): boolean {
	const code = getErrorCode(error);
	return (
		code === "ENOENT" ||
		code === "ENOTDIR" ||
		code === "EPERM" ||
		code === "EACCES"
	);
}

export function isUnsupportedRecursiveWatch(error: unknown): boolean {
	const code = getErrorCode(error);
	const message =
		error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM" ||
		message.includes("recursive") ||
		message.includes("not supported")
	);
}

export function mapEventType(eventType: import("node:fs").WatchEventType): "create" | "change" {
	return eventType === "rename" ? "create" : "change";
}

export function matchesExtensions(
	filePath: string,
	modules: string[] | undefined,
): boolean {
	if (!modules || modules.length === 0) return true;
	return modules.some((ext) => {
		const e = ext.startsWith(".") ? ext : `.${ext}`;
		return filePath.endsWith(e);
	});
}

export function isIgnored(name: string): boolean {
	return DEFAULT_IGNORE.has(name) || name.startsWith(".");
}

export function splitPathSegments(filePath: string): string[] {
	return filePath.split(/[\\/]/);
}

export function shouldTrackPath(active: ActiveWatcher, relativePath: string): boolean {
	const segments = splitPathSegments(relativePath);
	if (segments.some((segment) => isIgnored(segment))) return false;
	return matchesExtensions(relativePath, active.modules);
}

/** Recursively collect subdirectory paths for explicit directory watchers. */
export async function collectDirs(root: string): Promise<string[]> {
	const result: string[] = [root];
	try {
		const entries = await readdir(root, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory() && !isIgnored(entry.name)) {
				const full = join(root, entry.name);
				result.push(...(await collectDirs(full)));
			}
		}
	} catch (error) {
		if (!isIgnorableFsRace(error)) throw error;
	}
	return result;
}

export async function collectFileSnapshot(
	root: string,
	recursive: boolean,
	modules: string[] | undefined,
): Promise<Map<string, number>> {
	const snapshot = new Map<string, number>();

	async function visit(dir: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (error) {
			if (!isIgnorableFsRace(error)) throw error;
			return;
		}

		for (const entry of entries) {
			if (isIgnored(entry.name)) continue;
			const fullPath = join(dir, entry.name);
			const relativePath = relative(root, fullPath);

			if (entry.isDirectory()) {
				if (recursive) {
					await visit(fullPath);
				}
				continue;
			}

			if (!matchesExtensions(relativePath, modules)) continue;

			try {
				const entryStat = await stat(fullPath);
				snapshot.set(relativePath, entryStat.mtimeMs);
			} catch (error) {
				if (!isIgnorableFsRace(error)) throw error;
			}
		}
	}

	await visit(root);
	return snapshot;
}

export async function resolveDeletes(
	rootPath: string,
	changes: FileChange[],
): Promise<FileChange[]> {
	const results = await Promise.all(
		changes.map(async (c) => {
			if (c.type === "create") {
				try {
					const s = await stat(join(rootPath, c.path));
					if (s.isDirectory()) return null;
					return c;
				} catch (error) {
					if (!isIgnorableFsRace(error)) throw error;
					return { ...c, type: "delete" as const };
				}
			}
			return c;
		}),
	);
	return results.filter((c): c is FileChange => c !== null);
}

export function scheduleFlush(
	active: ActiveWatcher,
	flush: (active: ActiveWatcher) => void,
): void {
	if (active.timer) clearTimeout(active.timer);
	active.timer = setTimeout(() => flush(active), DEBOUNCE_MS);
}

export function flushPending(active: ActiveWatcher): void {
	if (active.pending.size === 0) return;

	const changes = [...active.pending.values()];
	active.pending.clear();
	active.timer = null;
	active.changeCount += changes.length;

	void resolveDeletes(active.rootPath, changes).then((resolved) => {
		if (resolved.length === 0) return;
		const bus = getEventBus();
		if (bus) {
			bus.emit("file.changed", {
				watchId: active.id,
				path: active.rootPath,
				changes: resolved,
			});
		}
	});
}

export function settleWatcherStartup(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, WATCHER_SETTLE_MS));
}
