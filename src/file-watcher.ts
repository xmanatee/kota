import { type FSWatcher, type WatchEventType, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { join, relative } from "node:path";
import {
	type ActiveWatcher,
	collectDirs,
	collectFileSnapshot,
	type FileChange,
	flushPending,
	isIgnorableFsRace,
	isUnsupportedRecursiveWatch,
	MAX_WATCHERS,
	mapEventType,
	POLL_INTERVAL_MS,
	scheduleFlush,
	settleWatcherStartup,
	shouldTrackPath,
	type WatcherInfo,
} from "./file-watcher-core.js";

export type { FileChange, WatcherInfo };

export class WatcherManager {
	private watchers = new Map<string, ActiveWatcher>();
	private nextId = 1;

	/** Start watching a directory. Returns the watcher ID. */
	async start(
		watchPath: string,
		options?: { recursive?: boolean; modules?: string[] },
	): Promise<string> {
		if (this.watchers.size >= MAX_WATCHERS) {
			throw new Error(
				`Maximum ${MAX_WATCHERS} watchers reached. Stop an existing watcher first.`,
			);
		}

		const recursive = options?.recursive ?? true;
		const modules = options?.modules;
		const id = `w${this.nextId++}`;

		const active: ActiveWatcher = {
			id,
			rootPath: watchPath,
			recursive,
			modules,
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
			active.modules,
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
			modules: w.modules,
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
			if (!shouldTrackPath(active, relativePath)) return;

			const fullPath = join(active.rootPath, relativePath);
			const relPath = relative(active.rootPath, fullPath);

			active.pending.set(relPath, { path: relPath, type: mapEventType(eventType) });
			scheduleFlush(active, flushPending);

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
				active.modules,
			);

			for (const [path, mtimeMs] of nextSnapshot) {
				const previousMtimeMs = active.snapshot.get(path);
				if (previousMtimeMs === undefined) {
					active.pending.set(path, { path, type: "create" });
					scheduleFlush(active, flushPending);
					continue;
				}
				if (previousMtimeMs !== mtimeMs) {
					active.pending.set(path, { path, type: "change" });
					scheduleFlush(active, flushPending);
				}
			}

			for (const path of active.snapshot.keys()) {
				if (!nextSnapshot.has(path)) {
					active.pending.set(path, { path, type: "delete" });
					scheduleFlush(active, flushPending);
				}
			}

			active.snapshot = nextSnapshot;
		} finally {
			active.polling = false;
		}
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
