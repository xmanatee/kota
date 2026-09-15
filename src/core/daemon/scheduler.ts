/** Timed reminders and event-triggered tasks, persisted per scope. */

import type { EventBus } from "#core/events/event-bus.js";
import type { BusEnvelope } from "#core/events/event-bus-types.js";
import type { ScopedEventBus } from "#core/events/scope.js";
import { isValidRepeatMs, matchesFilter } from "./schedule-parser.js";
import {
	compactSchedules,
	type ScheduleState,
	type ScheduleStorage,
} from "./scheduler-store.js";

export type { ScheduledItem } from "./schedule-parser.js";
export { parseRepeat, parseTime } from "./schedule-parser.js";

export type ReminderCommands = Pick<Scheduler, "add" | "addEventTrigger" | "pending" | "cancel">;

export class ScheduleInputError extends Error {}

export class Scheduler {
	private items: import("./schedule-parser.js").ScheduledItem[] = [];
	private nextId = 1;
	private revision = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private busUnsub: (() => void) | null = null;

	constructor(
		private readonly storage?: ScheduleStorage,
		private readonly pbus?: ScopedEventBus | null,
	) {}

	private ensureLoaded(): void {
		if (!this.storage) return;
		const snapshot = this.storage.database.readScopeStateValue<ScheduleState>(
			this.storage.scopeId,
			"reminders",
		);
		this.revision = snapshot.revision;
		this.items = snapshot.value?.items ?? [];
		this.nextId = snapshot.value?.nextId ?? 1;
	}

	private persist(): void {
		const items = compactSchedules(this.items);
		if (this.storage) {
			this.storage.database.compareAndSetScopeStateValue({
				scopeId: this.storage.scopeId,
				key: "reminders",
				expectedRevision: this.revision,
				value: { items, nextId: this.nextId },
				updatedAt: new Date().toISOString(),
			});
		}
		this.items = items;
	}

	add(
		description: string,
		triggerAt: Date,
		opts?: { repeatMs?: number; repeatLabel?: string },
	): import("./schedule-parser.js").ScheduledItem {
		if (!Number.isFinite(triggerAt.getTime())) {
			throw new ScheduleInputError("triggerAt must be a valid date");
		}
		if (opts?.repeatMs !== undefined) {
			if (!isValidRepeatMs(opts.repeatMs)) {
				throw new ScheduleInputError("repeatMs must be at least 1000 (1 second), in whole milliseconds within the Date range");
			}
			if (!Number.isFinite(new Date(Math.max(triggerAt.getTime(), Date.now()) + opts.repeatMs).getTime())) {
				throw new ScheduleInputError("Repeat interval exceeds the supported date range. Choose a shorter interval or earlier start time.");
			}
		}
		this.ensureLoaded();
		const item: import("./schedule-parser.js").ScheduledItem = {
			id: this.nextId++,
			description,
			triggerAt: triggerAt.toISOString(),
			status: "pending",
			created: new Date().toISOString(),
		};
		if (opts?.repeatMs !== undefined) {
			item.repeatMs = opts.repeatMs;
			if (opts.repeatLabel !== undefined) item.repeatLabel = opts.repeatLabel;
		}
		this.items.push(item);
		this.persist();
		return structuredClone(item);
	}

	/**
	 * Add an event-triggered item. Fires when `eventName` is emitted on the
	 * connected EventBus (optionally filtered by payload properties).
	 */
	addEventTrigger(
		description: string,
		eventName: string,
		opts?: {
			filter?: Record<string, string>;
			repeat?: boolean;
		},
	): import("./schedule-parser.js").ScheduledItem {
		this.ensureLoaded();
		if (!eventName) throw new Error("eventName is required");
		const item: import("./schedule-parser.js").ScheduledItem = {
			id: this.nextId++,
			description,
			triggerAt: new Date().toISOString(), // creation time (not used for matching)
			triggerEvent: eventName,
			status: "pending",
			created: new Date().toISOString(),
		};
		if (opts?.filter && Object.keys(opts.filter).length > 0) {
			item.triggerFilter = opts.filter;
		}
		if (opts?.repeat) item.repeat = true;
		this.items.push(item);
		this.persist();
		return structuredClone(item);
	}

	cancel(id: number): boolean {
		this.ensureLoaded();
		const item = this.items.find((i) => i.id === id);
		if (!item || item.status !== "pending") return false;
		item.status = "cancelled";
		this.persist();
		return true;
	}

	getDue(now?: Date): import("./schedule-parser.js").ScheduledItem[] {
		this.ensureLoaded();
		const ref = now || new Date();
		return structuredClone(
			this.items.filter(
				(i) =>
					i.status === "pending" &&
					!i.triggerEvent &&
					new Date(i.triggerAt) <= ref,
			),
		);
	}

	markFired(
		id: number,
		now?: Date,
	): import("./schedule-parser.js").ScheduledItem | null {
		this.ensureLoaded();
		const item = this.items.find((i) => i.id === id && i.status === "pending");
		if (!item) return null;
		const ref = now || new Date();
		const scheduledFor = item.triggerAt;

		if (item.triggerEvent && item.repeat) {
			item.firedAt = ref.toISOString();
		} else if (item.repeatMs !== undefined && Number.isFinite(item.repeatMs) && item.repeatMs >= 1000) {
			// Admission requires whole milliseconds, but previously saved recurrences
			// can contain fractional values from the old parser's float arithmetic.
			// Preserve their delivery semantics instead of turning them into one-shot.
			const previous = new Date(item.triggerAt).getTime();
			const periods = Math.max(
				1,
				Math.floor((ref.getTime() - previous) / item.repeatMs) + 1,
			);
			const next = new Date(previous + periods * item.repeatMs);
			// A finite date range eventually ends even for a valid recurring reminder.
			// Complete its last occurrence without crashing delivery for other items.
			if (Number.isFinite(next.getTime())) item.triggerAt = next.toISOString();
			else item.status = "fired";
			item.firedAt = ref.toISOString();
		} else {
			item.status = "fired";
			item.firedAt = ref.toISOString();
		}
		this.persist();
		if (this.pbus) {
			this.pbus.emit("schedule.fire", {
				itemId: item.id,
				description: item.description,
				scheduledFor,
				repeat: item.repeatLabel ?? null,
			});
		}
		return structuredClone(item);
	}

	list(): import("./schedule-parser.js").ScheduledItem[] {
		this.ensureLoaded();
		return structuredClone(this.items);
	}

	pending(): import("./schedule-parser.js").ScheduledItem[] {
		this.ensureLoaded();
		return structuredClone(this.items.filter((i) => i.status === "pending"));
	}

	get(id: number): import("./schedule-parser.js").ScheduledItem | undefined {
		this.ensureLoaded();
		return structuredClone(this.items.find((i) => i.id === id));
	}

	startTimer(
		intervalMs: number,
		onDue: (items: import("./schedule-parser.js").ScheduledItem[]) => void,
	): () => void {
		this.stopTimer();
		this.timer = setInterval(() => {
			this.ensureLoaded();
			const due = this.getDue();
			if (due.length > 0) {
				for (const item of due) this.markFired(item.id);
				onDue(due);
			}
		}, intervalMs);
		this.timer.unref();
		return () => this.stopTimer();
	}

	/**
	 * Subscribe to an EventBus so event-triggered items fire automatically.
	 * Calls `onFire` with matched items (same shape as `startTimer` callback).
	 * Returns an unsubscribe function.
	 */
	connectBus(
		bus: EventBus,
		onFire: (items: import("./schedule-parser.js").ScheduledItem[]) => void,
	): () => void {
		this.disconnectBus();
		const handleEnvelope = (envelope: BusEnvelope): void => {
			if (envelope.type === "schedule.fire") return;

			this.ensureLoaded();
			const matches = this.items.filter(
				(i) =>
					i.status === "pending" &&
					i.triggerEvent === envelope.type &&
					matchesFilter(
						envelope.payload as Record<string, unknown>,
						i.triggerFilter,
					),
			);
			if (matches.length === 0) return;

			for (const item of matches) this.markFired(item.id);
			onFire(matches);
		};
		this.busUnsub = this.pbus
			? this.pbus.onAny(handleEnvelope)
			: bus.on("*", handleEnvelope);
		return () => this.disconnectBus();
	}

	disconnectBus(): void {
		if (this.busUnsub) {
			this.busUnsub();
			this.busUnsub = null;
		}
	}

	stopTimer(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	count(): number {
		this.ensureLoaded();
		return this.items.filter((i) => i.status === "pending").length;
	}
}
