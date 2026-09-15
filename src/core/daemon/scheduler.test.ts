import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { Scheduler } from "./scheduler.js";

describe("Scheduler transitions", () => {
	let scheduler: Scheduler;
	let bus: EventBus;
	const now = new Date("2026-01-01T12:00:00Z");
	const future = new Date(now.getTime() + 60_000);

	beforeEach(() => {
		scheduler = new Scheduler();
		bus = new EventBus();
	});

	afterEach(() => {
		scheduler.stopTimer();
		scheduler.disconnectBus();
	});

	it("fires only due time reminders and makes one-shot completion idempotent", () => {
		const once = scheduler.add("Due now", now);
		const later = scheduler.add("Later", future);
		const event = scheduler.addEventTrigger("On end", "session.end");
		expect(scheduler.list()).toEqual([once, later, event]);
		expect(scheduler.getDue(now)).toEqual([once]);
		expect(scheduler.markFired(once.id, now)).toMatchObject({
			status: "fired",
			firedAt: now.toISOString(),
		});
		expect(scheduler.get(once.id)?.status).toBe("fired");
		expect(scheduler.getDue(now)).toEqual([]);
		expect(scheduler.pending()).toEqual([later, event]);
		expect(scheduler.count()).toBe(2);
		expect(scheduler.markFired(once.id, now)).toBeNull();
		expect(scheduler.cancel(once.id)).toBe(false);
		expect(scheduler.markFired(999, now)).toBeNull();
		expect(scheduler.cancel(999)).toBe(false);
	});

	it("cancels only the selected reminder and cannot fire or cancel it again", () => {
		const keep = scheduler.add("Keep", future);
		const remove = scheduler.add("Remove", future);
		expect(scheduler.cancel(remove.id)).toBe(true);
		expect(scheduler.cancel(remove.id)).toBe(false);
		expect(scheduler.markFired(remove.id, now)).toBeNull();
		expect(scheduler.get(remove.id)).toBeUndefined();
		expect(scheduler.list()).toEqual([keep]);
		expect(scheduler.pending()).toEqual([keep]);
		expect(scheduler.count()).toBe(1);
		expect(scheduler.add("Next", future).id).toBeGreaterThan(remove.id);
	});

	it.each([
		1000, 1500, 3_600_000, 86_400_000,
	])("preserves a %i ms repeat and advances to the next future occurrence", (repeatMs) => {
		const trigger = new Date(now.getTime() - 5 * repeatMs);
		const item = scheduler.add("Recurring", trigger, {
			repeatMs,
			repeatLabel: "repeat",
		});
		expect(item).toMatchObject({
			repeatMs,
			repeatLabel: "repeat",
			status: "pending",
		});
		scheduler.markFired(item.id, now);
		expect(scheduler.get(item.id)).toMatchObject({
			repeatMs,
			repeatLabel: "repeat",
			status: "pending",
			firedAt: now.toISOString(),
			triggerAt: new Date(now.getTime() + repeatMs).toISOString(),
		});
		expect(scheduler.getDue(now)).toEqual([]);
		const next = new Date(now.getTime() + repeatMs);
		expect(scheduler.getDue(next).map((entry) => entry.id)).toEqual([item.id]);
		scheduler.markFired(item.id, next);
		expect(scheduler.get(item.id)?.triggerAt).toBe(
			new Date(next.getTime() + repeatMs).toISOString(),
		);
	});

	it.each([0, -1000, 999, 1000.5, NaN, Infinity, Number.MAX_VALUE, 8_640_000_000_000_000])(
		"rejects invalid %s ms repeats before changing reminders or allocating an id", (repeatMs) => {
			const keep = scheduler.add("Keep", future);
			expect(() => scheduler.add("Invalid", future, { repeatMs })).toThrow();
			expect(scheduler.list()).toEqual([keep]);
			expect(scheduler.add("Next", future).id).toBe(keep.id + 1);
		},
	);

	it("rejects invalid dates and start-plus-repeat overflow before mutation", () => {
		const keep = scheduler.add("Keep", future);
		expect(() => scheduler.add("Invalid date", new Date(NaN))).toThrow("valid date");
		expect(() => scheduler.add("Overflow", new Date(8_640_000_000_000_000 - 999), { repeatMs: 1000 })).toThrow("date range");
		expect(scheduler.list()).toEqual([keep]);
		expect(scheduler.add("Next", future).id).toBe(keep.id + 1);
	});

	it("finishes the last representable recurrence without failing delivery", () => {
		const end = 8_640_000_000_000_000;
		const item = scheduler.add("At range boundary", new Date(end - 1000), { repeatMs: 1000 });
		expect(scheduler.markFired(item.id, new Date(end - 1000))).toMatchObject({ status: "pending", triggerAt: new Date(end).toISOString() });
		expect(scheduler.markFired(item.id, new Date(end))).toMatchObject({ status: "fired" });
		expect(scheduler.pending()).toEqual([]);
	});

	it("replaces a real timer callback and stops delivery on unsubscribe", async () => {
		const item = scheduler.add("Due", new Date(0));
		const replaced = vi.fn();
		const active = vi.fn();
		scheduler.startTimer(10, replaced);
		const stop = scheduler.startTimer(10, active);
		await vi.waitFor(() =>
			expect(active).toHaveBeenCalledExactlyOnceWith([item]),
		);
		expect(replaced).not.toHaveBeenCalled();
		expect(scheduler.get(item.id)?.status).toBe("fired");
		stop();
		stop();
		const pending = scheduler.add("After stop", new Date(0));
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(active).toHaveBeenCalledTimes(1);
		expect(replaced).not.toHaveBeenCalled();
		expect(scheduler.get(pending.id)?.status).toBe("pending");
	});

	it("delivers one-shot and filtered repeating events through the bus", () => {
		const once = scheduler.addEventTrigger("Any session", "session.end", {
			filter: {},
		});
		const repeat = scheduler.addEventTrigger("Build session", "session.end", {
			repeat: true,
			filter: { label: "build", sessionId: "s1" },
		});
		const fired: number[][] = [];
		scheduler.connectBus(bus, (items) =>
			fired.push(items.map((item) => item.id)),
		);
		bus.emit("session.start", { sessionId: "s1" });
		expect(fired).toEqual([]);
		bus.emit("session.end", { sessionId: "s1", durationMs: 100 });
		expect(fired).toEqual([[once.id]]);
		expect(scheduler.get(once.id)).toMatchObject({
			status: "fired",
			firedAt: expect.any(String),
		});
		bus.emit("session.end", {
			sessionId: "s2",
			label: "build",
			durationMs: 100,
		});
		expect(fired).toEqual([[once.id]]);
		bus.emit("session.end", {
			sessionId: "s1",
			label: "build",
			durationMs: 100,
		});
		bus.emit("session.end", {
			sessionId: "s1",
			label: "build",
			durationMs: 200,
		});
		expect(fired).toEqual([[once.id], [repeat.id], [repeat.id]]);
		expect(scheduler.pending()).toEqual([
			expect.objectContaining({
				id: repeat.id,
				status: "pending",
				repeat: true,
				firedAt: expect.any(String),
			}),
		]);
	});

	it("rejects an empty event name", () => {
		expect(() => scheduler.addEventTrigger("Bad", "")).toThrow(
			"eventName is required",
		);
		expect(scheduler.list()).toEqual([]);
	});

	it("replaces bus subscriptions and unsubscribes from custom events", () => {
		scheduler.addEventTrigger("On deploy", "deploy.success", { repeat: true });
		const replaced = vi.fn();
		const active = vi.fn();
		scheduler.connectBus(bus, replaced);
		const disconnect = scheduler.connectBus(bus, active);
		bus.emit("deploy.success", { sha: "abc123" });
		expect(replaced).not.toHaveBeenCalled();
		expect(active).toHaveBeenCalledTimes(1);
		disconnect();
		disconnect();
		bus.emit("deploy.success", { sha: "def456" });
		expect(active).toHaveBeenCalledTimes(1);
		expect(replaced).not.toHaveBeenCalled();
	});

	it("ignores schedule.fire so reminder notifications cannot trigger themselves", () => {
		const item = scheduler.addEventTrigger("Self-loop", "schedule.fire", {
			repeat: true,
		});
		const fired = vi.fn();
		scheduler.connectBus(bus, fired);
		bus.emit("schedule.fire", {
			scopeId: "test-scope",
			itemId: item.id,
			description: "test",
			scheduledFor: now.toISOString(),
			repeat: null,
		});
		expect(fired).not.toHaveBeenCalled();
		expect(scheduler.get(item.id)?.firedAt).toBeUndefined();
	});
});
