/**
 * FileWatcher — reactive filesystem monitoring with event bus integration.
 *
 * Uses fs.watch where available, supplements recursive watching with
 * per-directory watchers, and reconciles with periodic snapshots so missed
 * backend events still surface as "file.changed".
 */

import { type FSWatcher, type WatchEventType, watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { getEventBus } from "./event-bus.js";

export interface FileChange {
	path: string;
	type: "create" | "change" | "delete";
}

export interface WatcherInfo {
	id: string;
	path: string;
	recursive: boolean;
	extensions: string[] | undefined;
	changeCount: number;
	createdAt: string;
}

interface ActiveWatcher {
	id: string;
	rootPath: string;
	recursive: boolean;
	extensions: string[] | undefined;
	fsWatchers: FSWatcher[];
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

const DEBOUNCE_MS = 250;
const MAX_WATCHERS = 10;
const WATCHER_SETTLE_MS = 50;
const POLL_INTERVAL_MS = 500;

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

function isIgnorableFsRace(error: unknown): boolean {
	const code = getErrorCode(error);
	return (
		code === "ENOENT" ||
		code === "ENOTDIR" ||
		code === "EPERM" ||
		code === "EACCES"
	);
}

function isUnsupportedRecursiveWatch(error: unknown): boolean {
	const code = getErrorCode(error);
	const message =
		error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM" ||
		message.includes("recursive") ||
		message.includes("not supported")
	);
}

function mapEventType(eventType: WatchEventType): "create" | "change" {
	return eventType === "rename" ? "create" : "change";
}

function matchesExtensions(
	filePath: string,
	extensions: string[] | undefined,
): boolean {
	if (!extensions || extensions.length === 0) return true;
	return extensions.some((ext) => {
		const e = ext.startsWith(".") ? ext : `.${ext}`;
		return filePath.endsWith(e);
	});
}

function isIgnored(name: string): boolean {
	return DEFAULT_IGNORE.has(name) || name.startsWith(".");
}

function splitPathSegments(filePath: string): string[] {
	return filePath.split(/[\\/]/);
}

/** Recursively collect subdirectory paths for explicit directory watchers. */
async function collectDirs(root: string): Promise<string[]> {
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

async function collectFileSnapshot(
	root: string,
	recursive: boolean,
	extensions: string[] | undefined,
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

			if (!matchesExtensions(relativePath, extensions)) continue;

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

export class WatcherManager {
	private watchers = new Map<string, ActiveWatcher>();
	private nextId = 1;

	/** Start watching a directory. Returns the watcher ID. */
	async start(
		watchPath: string,
		options?: { recursive?: boolean; extensions?: string[] },
	): Promise<string> {
		if (this.watchers.size >= MAX_WATCHERS) {
			throw new Error(
				`Maximum ${MAX_WATCHERS} watchers reached. Stop an existing watcher first.`,
			);
		}

		const recursive = options?.recursive ?? true;
		const extensions = options?.extensions;
		const id = `w${this.nextId++}`;

		const active: ActiveWatcher = {
			id,
			rootPath: watchPath,
			recursive,
			extensions,
			fsWatchers: [],
			watchedDirs: new Set(),
			snapshot: new Map(),
			pollTimer: null,
			polling: false,
			pending: new Map(),
			timer: null,
			changeCount: 0,
			createdAt: new Date(),
		};

		await this.attachWatchers(active);
		active.snapshot = await collectFileSnapshot(
			active.rootPath,
			active.recursive,
			active.extensions,
		);
		active.pollTimer = setInterval(() => {
			void this.pollChanges(active);
		}, POLL_INTERVAL_MS);
		await settleWatcherStartup();
		this.watchers.set(id, active);
		return id;
	}

	/** Stop a watcher by ID. Returns true if found and stopped. */
	stop(id: string): boolean {
		const active = this.watchers.get(id);
		if (!active) return false;
		this.closeWatcher(active);
		this.watchers.delete(id);
		return true;
	}

	/** List all active watchers. */
	list(): WatcherInfo[] {
		return [...this.watchers.values()].map((w) => ({
			id: w.id,
			path: w.rootPath,
			recursive: w.recursive,
			extensions: w.extensions,
			changeCount: w.changeCount,
			createdAt: w.createdAt.toISOString(),
		}));
	}

	/** Stop all watchers. */
	closeAll(): void {
		for (const active of this.watchers.values()) {
			this.closeWatcher(active);
		}
		this.watchers.clear();
	}

	get size(): number {
		return this.watchers.size;
	}

	private async attachWatchers(active: ActiveWatcher): Promise<void> {
		const queueChange = (eventType: WatchEventType, relativePath: string) => {
			if (!this.shouldTrackPath(active, relativePath)) return;

			const fullPath = join(active.rootPath, relativePath);
			const relPath = relative(active.rootPath, fullPath);

			this.queuePendingChange(active, relPath, mapEventType(eventType));

			if (active.recursive && eventType === "rename") {
				void this.attachRecursiveSubdirectories(active, fullPath, queueChange);
			}
		};

		if (active.recursive) {
			try {
				const fsw = watch(
					active.rootPath,
					{ recursive: true },
					(eventType, filename) => {
						if (!filename) return;
						queueChange(eventType, filename);
					},
				);
				fsw.on("error", () => {
					this.handleWatcherBackendError(active, fsw);
				});
				active.fsWatchers.push(fsw);
			} catch (error) {
				if (!isUnsupportedRecursiveWatch(error) && !isIgnorableFsRace(error)) {
					throw error;
				}
			}
		}

		const dirs = active.recursive
			? await collectDirs(active.rootPath)
			: [active.rootPath];
		for (const dir of dirs) {
			this.attachDirectoryWatcher(active, dir, queueChange);
		}
	}

	private shouldTrackPath(active: ActiveWatcher, relativePath: string): boolean {
		const segments = splitPathSegments(relativePath);
		if (segments.some((segment) => isIgnored(segment))) return false;
		return matchesExtensions(relativePath, active.extensions);
	}

	private queuePendingChange(
		active: ActiveWatcher,
		relativePath: string,
		type: FileChange["type"],
	): void {
		active.pending.set(relativePath, {
			path: relativePath,
			type,
		});
		this.scheduleFlush(active);
	}

	private attachDirectoryWatcher(
		active: ActiveWatcher,
		dir: string,
		queueChange: (eventType: WatchEventType, relativePath: string) => void,
	): void {
		if (active.watchedDirs.has(dir)) return;
		try {
			const fsw = watch(dir, (eventType, filename) => {
				if (!filename) return;
				queueChange(eventType, relative(active.rootPath, join(dir, filename)));
			});
			fsw.on("error", () => {
				this.handleWatcherBackendError(active, fsw, dir);
			});
			active.fsWatchers.push(fsw);
			active.watchedDirs.add(dir);
		} catch (error) {
			if (!isIgnorableFsRace(error)) throw error;
		}
	}

	private async attachRecursiveSubdirectories(
		active: ActiveWatcher,
		fullPath: string,
		queueChange: (eventType: WatchEventType, relativePath: string) => void,
	): Promise<void> {
		try {
			const stats = await stat(fullPath);
			if (!stats.isDirectory()) return;
			const dirs = await collectDirs(fullPath);
			for (const dir of dirs) {
				this.attachDirectoryWatcher(active, dir, queueChange);
			}
		} catch (error) {
			if (!isIgnorableFsRace(error)) throw error;
		}
	}

	private async pollChanges(active: ActiveWatcher): Promise<void> {
		if (active.polling || !this.watchers.has(active.id)) return;
		active.polling = true;

		try {
			const nextSnapshot = await collectFileSnapshot(
				active.rootPath,
				active.recursive,
				active.extensions,
			);

			for (const [path, mtimeMs] of nextSnapshot) {
				const previousMtimeMs = active.snapshot.get(path);
				if (previousMtimeMs === undefined) {
					this.queuePendingChange(active, path, "create");
					continue;
				}
				if (previousMtimeMs !== mtimeMs) {
					this.queuePendingChange(active, path, "change");
				}
			}

			for (const path of active.snapshot.keys()) {
				if (!nextSnapshot.has(path)) {
					this.queuePendingChange(active, path, "delete");
				}
			}

			active.snapshot = nextSnapshot;
		} finally {
			active.polling = false;
		}
	}

	private scheduleFlush(active: ActiveWatcher): void {
		if (active.timer) clearTimeout(active.timer);
		active.timer = setTimeout(() => this.flush(active), DEBOUNCE_MS);
	}

	private flush(active: ActiveWatcher): void {
		if (active.pending.size === 0) return;

		const changes = [...active.pending.values()];
		active.pending.clear();
		active.timer = null;
		active.changeCount += changes.length;

		void this.resolveDeletes(active.rootPath, changes).then((resolved) => {
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

	private async resolveDeletes(
		rootPath: string,
		changes: FileChange[],
	): Promise<FileChange[]> {
		return Promise.all(
			changes.map(async (c) => {
				if (c.type === "create") {
					try {
						await stat(join(rootPath, c.path));
						return c;
					} catch (error) {
						if (!isIgnorableFsRace(error)) throw error;
						return { ...c, type: "delete" as const };
					}
				}
				return c;
			}),
		);
	}

	private handleWatcherBackendError(
		active: ActiveWatcher,
		fsw: FSWatcher,
		dir?: string,
	): void {
		active.fsWatchers = active.fsWatchers.filter((candidate) => candidate !== fsw);
		if (dir) active.watchedDirs.delete(dir);
		fsw.close();
		void this.pollChanges(active);
	}

	private closeWatcher(active: ActiveWatcher): void {
		if (active.timer) clearTimeout(active.timer);
		if (active.pollTimer) clearInterval(active.pollTimer);
		for (const fsw of active.fsWatchers) {
			fsw.close();
		}
		active.fsWatchers = [];
		active.pending.clear();
	}
}

// --- Singleton ---

let instance: WatcherManager | undefined;

export function getWatcherManager(): WatcherManager {
	if (!instance) instance = new WatcherManager();
	return instance;
}

export function resetWatcherManager(): void {
	if (instance) instance.closeAll();
	instance = undefined;
}

function settleWatcherStartup(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, WATCHER_SETTLE_MS));
}
