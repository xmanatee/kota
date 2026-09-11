import type { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { ScheduledItem } from "./schedule-parser.js";

export type ScheduleState = { items: ScheduledItem[]; nextId: number };
export type ScheduleStorage = { database: RunStateDatabase; scopeId: string };
const MAX_FIRED = 20;

export function compactSchedules(items: ScheduledItem[]): ScheduledItem[] {
	const fired = items.filter((i) => i.status === "fired");
	let clean = items;
	if (fired.length > MAX_FIRED) {
		const sorted = [...fired].sort((a, b) =>
			(a.firedAt || a.created).localeCompare(b.firedAt || b.created),
		);
		const removeIds = new Set(
			sorted.slice(0, fired.length - MAX_FIRED).map((i) => i.id),
		);
		clean = items.filter((i) => !removeIds.has(i.id));
	}
	clean = clean.filter((i) => i.status !== "cancelled");
	return clean;
}
