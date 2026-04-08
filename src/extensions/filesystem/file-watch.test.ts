import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EventBus, initEventBus, resetEventBus } from "../../event-bus.js";
import { WatcherManager } from "../../file-watcher.js";
import { runFileWatch } from "./file-watch.js";

// Helper: wait for event bus emission with timeout
function waitForEvent(
	bus: EventBus,
	event: string,
	timeoutMs = 2000,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`Timeout waiting for ${event}`)),
			timeoutMs,
		);
		bus.once(event, (payload: Record<string, unknown>) => {
			clearTimeout(timer);
			resolve(payload);
		});
	});
}

// Helper: wait for the first event matching a predicate
function waitForEventMatching(
	bus: EventBus,
	event: string,
	predicate: (payload: Record<string, unknown>) => boolean,
	timeoutMs = 3000,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`Timeout waiting for ${event} matching predicate`)),
			timeoutMs,
		);
		const unsub = bus.on(event, (payload: Record<string, unknown>) => {
			if (predicate(payload)) {
				clearTimeout(timer);
				unsub();
				resolve(payload);
			}
		});
	});
}

describe("WatcherManager", () => {
	let tmpDir: string;
	let mgr: WatcherManager;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "kota-watch-"));
		mgr = new WatcherManager();
	});

	afterEach(async () => {
		mgr.closeAll();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("starts a watcher and returns an ID", async () => {
		const id = await mgr.start(tmpDir);
		expect(id).toMatch(/^w\d+$/);
		expect(mgr.size).toBe(1);
	});

	it("lists active watchers", async () => {
		await mgr.start(tmpDir);
		const list = mgr.list();
		expect(list).toHaveLength(1);
		expect(list[0].path).toBe(tmpDir);
		expect(list[0].recursive).toBe(true);
		expect(list[0].changeCount).toBe(0);
	});

	it("stops a watcher by ID", async () => {
		const id = await mgr.start(tmpDir);
		expect(mgr.stop(id)).toBe(true);
		expect(mgr.size).toBe(0);
	});

	it("returns false when stopping unknown ID", () => {
		expect(mgr.stop("w999")).toBe(false);
	});

	it("closeAll stops all watchers", async () => {
		await mgr.start(tmpDir);
		const tmpDir2 = await mkdtemp(join(tmpdir(), "kota-watch-"));
		await mgr.start(tmpDir2);
		expect(mgr.size).toBe(2);
		mgr.closeAll();
		expect(mgr.size).toBe(0);
		await rm(tmpDir2, { recursive: true, force: true });
	});

	it("enforces max watchers limit", async () => {
		const dirs: string[] = [];
		for (let i = 0; i < 10; i++) {
			const d = await mkdtemp(join(tmpdir(), "kota-watch-"));
			dirs.push(d);
			await mgr.start(d);
		}
		const extra = await mkdtemp(join(tmpdir(), "kota-watch-"));
		dirs.push(extra);
		await expect(mgr.start(extra)).rejects.toThrow("Maximum 10 watchers");
		for (const d of dirs) {
			await rm(d, { recursive: true, force: true });
		}
	});

	it("starts with extension filter", async () => {
		const id = await mgr.start(tmpDir, { extensions: [".ts", ".json"] });
		const list = mgr.list();
		expect(list[0].extensions).toEqual([".ts", ".json"]);
		mgr.stop(id);
	});

	it("starts non-recursive watcher", async () => {
		const id = await mgr.start(tmpDir, { recursive: false });
		const list = mgr.list();
		expect(list[0].recursive).toBe(false);
		mgr.stop(id);
	});

	it("increments watcher IDs", async () => {
		const id1 = await mgr.start(tmpDir);
		mgr.stop(id1);
		const tmpDir2 = await mkdtemp(join(tmpdir(), "kota-watch-"));
		const id2 = await mgr.start(tmpDir2);
		expect(id1).not.toBe(id2);
		mgr.stop(id2);
		await rm(tmpDir2, { recursive: true, force: true });
	});
});

describe("WatcherManager event emission", () => {
	let tmpDir: string;
	let mgr: WatcherManager;
	let bus: EventBus;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "kota-watch-"));
		mgr = new WatcherManager();
		bus = initEventBus();
	});

	afterEach(async () => {
		mgr.closeAll();
		resetEventBus();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("emits file.changed event on file creation", async () => {
		await mgr.start(tmpDir);
		const eventPromise = waitForEventMatching(
			bus,
			"file.changed",
			(payload) => {
				const changes = payload.changes as { path: string; type: string }[];
				return Array.isArray(changes) && changes.some((c) => c.path.includes("test.txt"));
			},
		);

		await writeFile(join(tmpDir, "test.txt"), "hello");

		const payload = await eventPromise;
		expect(payload.watchId).toMatch(/^w\d+$/);
		expect(payload.path).toBe(tmpDir);
		expect(Array.isArray(payload.changes)).toBe(true);
		const changes = payload.changes as { path: string; type: string }[];
		expect(changes.length).toBeGreaterThan(0);
		expect(changes.some((c) => c.path.includes("test.txt"))).toBe(true);
	});

	it("emits file.changed event on file modification", async () => {
		await writeFile(join(tmpDir, "existing.txt"), "initial");
		await mgr.start(tmpDir);

		const eventPromise = waitForEvent(bus, "file.changed");
		await writeFile(join(tmpDir, "existing.txt"), "modified");

		const payload = await eventPromise;
		const changes = payload.changes as { path: string; type: string }[];
		expect(changes.some((c) => c.path.includes("existing.txt"))).toBe(true);
	});

	it("filters by extension", async () => {
		await mgr.start(tmpDir, { extensions: [".ts"] });

		// Write a .txt file — should not trigger event
		await writeFile(join(tmpDir, "skip.txt"), "not watched");

		// Write a .ts file — should trigger event
		const eventPromise = waitForEvent(bus, "file.changed");
		await writeFile(join(tmpDir, "code.ts"), "const x = 1;");

		const payload = await eventPromise;
		const changes = payload.changes as { path: string; type: string }[];
		expect(changes.some((c) => c.path.includes("code.ts"))).toBe(true);
		expect(changes.some((c) => c.path.includes("skip.txt"))).toBe(false);
	});

	it("ignores node_modules changes", async () => {
		const nmDir = join(tmpDir, "node_modules");
		await mkdir(nmDir, { recursive: true });

		// Let FSEvents settle after mkdir before starting watcher
		await new Promise((r) => setTimeout(r, 300));
		await mgr.start(tmpDir);
		// Drain any initial events
		await new Promise((r) => setTimeout(r, 400));

		const nodeModulesEvents: Record<string, unknown>[] = [];
		bus.on("file.changed", (payload: Record<string, unknown>) => {
			nodeModulesEvents.push(payload);
		});
		await writeFile(join(nmDir, "pkg.js"), "module.exports = {};");

		// Wait longer than debounce
		await new Promise((r) => setTimeout(r, 500));

		// If any events fired, none should contain node_modules paths
		for (const ev of nodeModulesEvents) {
			const changes = ev.changes as { path: string; type: string }[];
			expect(changes.some((c) => c.path.includes("pkg.js"))).toBe(false);
		}
	});

	it("detects file deletion", async () => {
		const filePath = join(tmpDir, "toDelete.txt");
		await writeFile(filePath, "will be deleted");
		await mgr.start(tmpDir);

		const eventPromise = waitForEvent(bus, "file.changed");
		await unlink(filePath);

		const payload = await eventPromise;
		const changes = payload.changes as { path: string; type: string }[];
		expect(changes.some((c) => c.type === "delete")).toBe(true);
	});

	it("batches rapid changes into single event", async () => {
		await mgr.start(tmpDir);

		let emitCount = 0;
		bus.on("file.changed", () => {
			emitCount++;
		});

		// Write 3 files rapidly
		await writeFile(join(tmpDir, "a.txt"), "a");
		await writeFile(join(tmpDir, "b.txt"), "b");
		await writeFile(join(tmpDir, "c.txt"), "c");

		// Wait for debounce to flush
		await new Promise((r) => setTimeout(r, 500));

		// Should batch into 1-2 events (not 3+)
		expect(emitCount).toBeLessThanOrEqual(2);
	});
});

describe("WatcherManager subdirectory watching", () => {
	let tmpDir: string;
	let mgr: WatcherManager;
	let bus: EventBus;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "kota-watch-"));
		mgr = new WatcherManager();
		bus = initEventBus();
	});

	afterEach(async () => {
		mgr.closeAll();
		resetEventBus();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("detects changes in subdirectories with recursive mode", async () => {
		const subDir = join(tmpDir, "src");
		await mkdir(subDir);
		await mgr.start(tmpDir, { recursive: true });

		const eventPromise = waitForEventMatching(
			bus,
			"file.changed",
			(payload) => {
				const changes = payload.changes as { path: string; type: string }[];
				return changes.some(
					(c) => c.path.includes("main.ts") && c.path.includes("src"),
				);
			},
			3000,
		);
		await writeFile(join(subDir, "main.ts"), "console.log('hello');");

		await eventPromise;
	});
});

describe("runFileWatch tool", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "kota-watch-"));
	});

	afterEach(async () => {
		// Import singleton and clean up
		const { resetWatcherManager } = await import("../../file-watcher.js");
		resetWatcherManager();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("starts a watcher via tool", async () => {
		const result = await runFileWatch({ action: "start", path: tmpDir });
		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("started");
		expect(result.content).toContain("file.changed");
	});

	it("lists watchers via tool", async () => {
		await runFileWatch({ action: "start", path: tmpDir });
		const result = await runFileWatch({ action: "list" });
		expect(result.content).toContain("1 active");
		expect(result.content).toContain(tmpDir);
	});

	it("stops a watcher via tool", async () => {
		const startResult = await runFileWatch({
			action: "start",
			path: tmpDir,
		});
		const id = startResult.content.match(/w\d+/)?.[0];
		expect(id).toBeDefined();

		const stopResult = await runFileWatch({ action: "stop", id });
		expect(stopResult.is_error).toBeUndefined();
		expect(stopResult.content).toContain("stopped");

		const listResult = await runFileWatch({ action: "list" });
		expect(listResult.content).toBe("No active watchers.");
	});

	it("returns error for start without path", async () => {
		const result = await runFileWatch({ action: "start" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("path is required");
	});

	it("returns error for stop without id", async () => {
		const result = await runFileWatch({ action: "stop" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("id is required");
	});

	it("returns error for stop with unknown id", async () => {
		const result = await runFileWatch({ action: "stop", id: "w999" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("not found");
	});

	it("returns error for unknown action", async () => {
		const result = await runFileWatch({ action: "invalid" });
		expect(result.is_error).toBe(true);
	});

	it("shows extension filter in start response", async () => {
		const result = await runFileWatch({
			action: "start",
			path: tmpDir,
			extensions: [".ts", ".json"],
		});
		expect(result.content).toContain(".ts");
		expect(result.content).toContain(".json");
	});
});
