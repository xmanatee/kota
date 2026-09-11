import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { scopeHash } from "./schedule-parser.js";
import { Scheduler } from "./scheduler.js";
import { migrateSchedules } from "./scheduler-migration.js";

let root: string;
let database: RunStateDatabase;
const opened: RunStateDatabase[] = [];
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "kota-reminders-"));
	database = new RunStateDatabase(join(root, ".kota"));
	opened.push(database);
	for (const id of ["scope-a", "scope-b"])
		database.registerScope({
			id,
			rootPath: join(root, id),
			displayName: id,
			createdAt: new Date().toISOString(),
		});
});
afterEach(() => {
	for (const db of opened.splice(0)) db.close();
	rmSync(root, { recursive: true, force: true });
});
const scopeId = "scope-a";
const future = () => new Date(Date.now() + 60000);

describe("durable reminders", () => {
	it("preserves interleaved client writes, cancellation, restart and scope isolation", () => {
		const a = new Scheduler({ database, scopeId });
		const reader = RunStateDatabase.openExisting(join(root, ".kota"));
		opened.push(reader);
		const b = new Scheduler({ database: reader, scopeId });
		expect(b.list()).toEqual([]);
		const first = a.add("first", future());
		const second = b.add("second", future());
		a.cancel(first.id);
		b.add("third", future());
		expect(a.pending().map((item) => item.description)).toEqual([
			"second",
			"third",
		]);
		expect(second.id).toBe(2);
		expect(new Scheduler({ database, scopeId: "scope-b" }).list()).toEqual([]);
		const restarted = RunStateDatabase.openExisting(join(root, ".kota"));
		opened.push(restarted);
		expect(new Scheduler({ database: restarted, scopeId }).pending()).toEqual(
			a.pending(),
		);
	});

	it("imports legacy records once and preserves malformed input for diagnosis", () => {
		const path = join(root, ".kota", `schedules-${scopeHash(root)}.json`);
		mkdirSync(join(root, ".kota"), { recursive: true });
		writeFileSync(path, '{"items":"broken"}');
		expect(() => migrateSchedules(root, { database, scopeId })).toThrow(
			"Invalid legacy reminders",
		);
		expect(existsSync(path)).toBe(true);
		expect(database.readScopeStateValue(scopeId, "reminders").revision).toBe(0);
		const item = {
			id: 7,
			description: "legacy",
			status: "pending",
			triggerAt: future().toISOString(),
			created: new Date().toISOString(),
		};
		const legacy = JSON.stringify({ scope: root, items: [item], nextId: 8 });
		writeFileSync(path, legacy);
		migrateSchedules(root, { database, scopeId });
		expect(existsSync(path)).toBe(false);
		const scheduler = new Scheduler({ database, scopeId });
		expect(scheduler.pending()).toEqual([item]);
		scheduler.cancel(7);
		// Crash after commit, before legacy deletion: database remains authoritative.
		writeFileSync(path, legacy);
		migrateSchedules(root, { database, scopeId });
		expect(scheduler.pending()).toEqual([]);
		expect(scheduler.add("new", future()).id).toBe(8);
	});

	it("persists repeat advancement and bounds completed history", () => {
		const scheduler = new Scheduler({ database, scopeId });
		const repeat = scheduler.add("repeat", new Date(0), { repeatMs: 1000 });
		scheduler.markFired(repeat.id, new Date(1000000000000));
		expect(scheduler.get(repeat.id)?.triggerAt).toBe(
			new Date(1000000001000).toISOString(),
		);
		for (let i = 0; i < 25; i++)
			scheduler.markFired(scheduler.add(`done ${i}`, future()).id);
		expect(
			scheduler.list().filter((item) => item.status === "fired"),
		).toHaveLength(20);
		expect(scheduler.pending()).toHaveLength(1);
	});
});
