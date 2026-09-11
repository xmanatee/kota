import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { type ScheduledItem, scopeHash } from "./schedule-parser.js";
import { compactSchedules, type ScheduleStorage } from "./scheduler-store.js";
import { scopeStorageIdentity } from "./scope-storage-identity.js";

/** One-way import, invoked only by daemon scope composition before delivery starts. */
export function migrateSchedules(
	scopeRoot: string,
	storage: ScheduleStorage,
): void {
	const scope = scopeStorageIdentity(scopeRoot);
	const path = join(scope, ".kota", `schedules-${scopeHash(scope)}.json`);
	if (!existsSync(path)) return;
	const snapshot = storage.database.readScopeStateValue(
		storage.scopeId,
		"reminders",
	);
	if (snapshot.revision === 0) {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			!isRecord(raw) ||
			raw.scope !== scope ||
			!Array.isArray(raw.items) ||
			!raw.items.every(isScheduledItem) ||
			!Number.isSafeInteger(raw.nextId) ||
			(raw.nextId as number) <=
				Math.max(0, ...raw.items.map((item) => item.id)) ||
			new Set(raw.items.map((item) => item.id)).size !== raw.items.length
		) {
			throw new Error(`Invalid legacy reminders: ${path}`);
		}
		storage.database.compareAndSetScopeStateValue({
			scopeId: storage.scopeId,
			key: "reminders",
			expectedRevision: 0,
			value: { items: compactSchedules(raw.items), nextId: raw.nextId },
			updatedAt: new Date().toISOString(),
		});
	}
	// Database commit precedes removal; a restart after commit cannot import twice.
	unlinkSync(path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDate(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function isScheduledItem(value: unknown): value is ScheduledItem {
	return (
		isRecord(value) &&
		Number.isSafeInteger(value.id) &&
		(value.id as number) > 0 &&
		typeof value.description === "string" &&
		isDate(value.triggerAt) &&
		isDate(value.created) &&
		["pending", "fired", "cancelled"].includes(value.status as string) &&
		(value.firedAt === undefined || isDate(value.firedAt)) &&
		(value.repeatMs === undefined ||
			(typeof value.repeatMs === "number" &&
				Number.isFinite(value.repeatMs) &&
				value.repeatMs >= 1000)) &&
		(value.repeatLabel === undefined ||
			typeof value.repeatLabel === "string") &&
		(value.triggerEvent === undefined ||
			(typeof value.triggerEvent === "string" &&
				value.triggerEvent.length > 0)) &&
		(value.repeat === undefined || typeof value.repeat === "boolean") &&
		(value.triggerFilter === undefined ||
			(isRecord(value.triggerFilter) &&
				Object.values(value.triggerFilter).every((v) => typeof v === "string")))
	);
}
