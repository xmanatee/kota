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
import type { ScheduleState } from "./scheduler-store.js";

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
			scheduler.markFired(
				scheduler.add(`done ${i}`, future()).id,
				new Date(1000000000000 + i),
			);
		const restarted = RunStateDatabase.openExisting(join(root, ".kota"));
		opened.push(restarted);
		const restored = new Scheduler({ database: restarted, scopeId });
		expect(
			restored
				.list()
				.filter((item) => item.status === "fired")
				.map((item) => item.description),
		).toEqual(Array.from({ length: 20 }, (_, i) => `done ${i + 5}`));
		expect(restored.pending()).toEqual([scheduler.get(repeat.id)]);
	});

	it("preserves previously stored fractional recurrence through firing and restart", () => {
		const triggerAt = "2026-09-15T09:00:00.000Z";
		// The previous parser multiplied decimal seconds using binary floats.
		const repeatMs = 1.001 * 1000;
		const item = {
			id: 1,
			description: "Existing fractional recurrence",
			triggerAt,
			repeatMs,
			repeatLabel: "every 1.001 seconds",
			status: "pending" as const,
			created: triggerAt,
		};
		database.compareAndSetScopeStateValue({
			scopeId,
			key: "reminders",
			expectedRevision: 0,
			value: { items: [item], nextId: 2 },
			updatedAt: triggerAt,
		});
		const scheduler = new Scheduler({ database, scopeId });
		const keep = scheduler.add("Unrelated reminder", new Date("2026-09-16T09:00:00Z"));
		expect(scheduler.getDue(new Date(triggerAt))).toEqual([item]);
		scheduler.markFired(item.id, new Date(triggerAt));
		const next = {
			...item,
			triggerAt: "2026-09-15T09:00:01.001Z",
			firedAt: triggerAt,
		};
		expect(scheduler.pending()).toEqual([next, keep]);

		const reopened = RunStateDatabase.openExisting(join(root, ".kota"));
		opened.push(reopened);
		const restored = new Scheduler({ database: reopened, scopeId });
		expect(restored.getDue(new Date(next.triggerAt))).toEqual([next]);
		restored.markFired(item.id, new Date(next.triggerAt));
		expect(scheduler.pending()).toEqual([
			{ ...next, triggerAt: "2026-09-15T09:00:02.002Z", firedAt: next.triggerAt },
			keep,
		]);
	});

	it("treats a stored sub-second repeat as one-shot", () => {
		const scheduler = new Scheduler({ database, scopeId });
		const item = scheduler.add("Corrupt repeat", new Date(0));
		const snapshot = database.readScopeStateValue<ScheduleState>(
			scopeId,
			"reminders",
		);
		// Write through the real persistence boundary; Scheduler reads return clones.
		database.compareAndSetScopeStateValue({
			scopeId,
			key: "reminders",
			expectedRevision: snapshot.revision,
			value: { items: [{ ...item, repeatMs: 100 }], nextId: item.id + 1 },
			updatedAt: new Date().toISOString(),
		});
		expect(scheduler.get(item.id)?.repeatMs).toBe(100);
		scheduler.markFired(item.id);
		expect(scheduler.get(item.id)).toMatchObject({
			status: "fired",
			firedAt: expect.any(String),
		});
		expect(scheduler.getDue()).toEqual([]);
	});
});
