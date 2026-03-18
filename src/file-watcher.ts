/**
 * FileWatcher — reactive filesystem monitoring with event bus integration.
 *
 * Uses Node's built-in fs.watch. On macOS/Windows, recursive watching is native.
 * On Linux, falls back to per-directory watchers. All change events are batch-
 * debounced (250ms trailing) and emitted on the EventBus as "file.changed".
 *
 * Singleton pattern — shared across sessions and modules.
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

/** Recursively collect subdirectory paths (for Linux fallback). */
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
	} catch {
		// Permission denied or deleted — skip
	}
	return result;
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
			pending: new Map(),
			timer: null,
			changeCount: 0,
			createdAt: new Date(),
		};

		await this.attachWatchers(active);
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
		const handler = (eventType: WatchEventType, filename: string | null) => {
			if (!filename) return;
			const segments = filename.split("/");
			if (segments.some((s) => isIgnored(s))) return;
			if (!matchesExtensions(filename, active.extensions)) return;

			const fullPath = join(active.rootPath, filename);
			const relPath = relative(active.rootPath, fullPath);

			active.pending.set(relPath, {
				path: relPath,
				type: mapEventType(eventType),
			});
			this.schedulFlush(active);
		};

		if (active.recursive) {
			try {
				const fsw = watch(
					active.rootPath,
					{ recursive: true },
					handler,
				);
				fsw.on("error", () => {});
				active.fsWatchers.push(fsw);
				return;
			} catch {
				// Linux: recursive not supported — fall back to per-directory
			}
		}

		// Non-recursive or Linux fallback: watch each directory individually
		const dirs = active.recursive
			? await collectDirs(active.rootPath)
			: [active.rootPath];
		for (const dir of dirs) {
			try {
				const fsw = watch(dir, (eventType, filename) => {
					if (!filename) return;
					const relFromRoot = relative(
						active.rootPath,
						join(dir, filename),
					);
					handler(eventType, relFromRoot);
				});
				fsw.on("error", () => {});
				active.fsWatchers.push(fsw);
			} catch {
				// Directory may have been deleted — skip
			}
		}
	}

	private schedulFlush(active: ActiveWatcher): void {
		if (active.timer) clearTimeout(active.timer);
		active.timer = setTimeout(() => this.flush(active), DEBOUNCE_MS);
	}

	private flush(active: ActiveWatcher): void {
		if (active.pending.size === 0) return;

		const changes = [...active.pending.values()];
		active.pending.clear();
		active.timer = null;
		active.changeCount += changes.length;

		// Detect deletes by checking existence
		this.resolveDeletes(active.rootPath, changes).then((resolved) => {
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
					} catch {
						return { ...c, type: "delete" as const };
					}
				}
				return c;
			}),
		);
	}

	private closeWatcher(active: ActiveWatcher): void {
		if (active.timer) clearTimeout(active.timer);
		for (const fsw of active.fsWatchers) {
			try {
				fsw.close();
			} catch {
				// Already closed
			}
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
