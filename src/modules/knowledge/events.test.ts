import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EventBus, initEventBus, resetEventBus } from "#core/events/event-bus.js";
import {
	initProviderRegistry,
	KNOWLEDGE_PROVIDER_TOKEN,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { runKnowledge } from "./knowledge.js";
import { KnowledgeStore, resetKnowledgeStore } from "./store.js";

describe("knowledge events", () => {
	let tmpDir: string;
	let bus: EventBus;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "kota-kev-"));
		bus = initEventBus();
		resetKnowledgeStore();
		const registry = initProviderRegistry();
		registry.register(KNOWLEDGE_PROVIDER_TOKEN, "default", new KnowledgeStore(tmpDir));
	});

	afterEach(() => {
		resetEventBus();
		resetProviderRegistry();
		resetKnowledgeStore();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("emits knowledge.create on successful create", async () => {
		const events: { id: string; title: string; type: string; tags: string[]; scope: string }[] = [];
		bus.on("knowledge.create", (payload) => events.push(payload));

		const result = await runKnowledge({
			action: "create",
			title: "Test Entry",
			content: "Some content",
			type: "note",
			tags: ["test", "events"],
		});
		expect(result.is_error).toBeUndefined();
		expect(events).toHaveLength(1);
		expect(events[0].title).toBe("Test Entry");
		expect(events[0].type).toBe("note");
		expect(events[0].tags).toEqual(["test", "events"]);
		expect(events[0].scope).toBe("project");
		expect(events[0].id).toBeTruthy();
	});

	it("emits knowledge.update on successful update", async () => {
		const events: { id: string; fields: string[] }[] = [];
		bus.on("knowledge.update", (payload) => events.push(payload));

		const store = new KnowledgeStore(tmpDir);
		const id = store.create({ title: "Updatable", content: "Original" });

		const result = await runKnowledge({
			action: "update",
			id,
			content: "Modified content",
			tags: ["updated"],
		});
		expect(result.is_error).toBeUndefined();
		expect(events).toHaveLength(1);
		expect(events[0].id).toBe(id);
		expect(events[0].fields).toContain("content");
		expect(events[0].fields).toContain("tags");
	});

	it("emits knowledge.delete on successful delete", async () => {
		const events: { id: string }[] = [];
		bus.on("knowledge.delete", (payload) => events.push(payload));

		const store = new KnowledgeStore(tmpDir);
		const id = store.create({ title: "Deletable", content: "Will be deleted" });

		const result = await runKnowledge({ action: "delete", id });
		expect(result.is_error).toBeUndefined();
		expect(events).toHaveLength(1);
		expect(events[0].id).toBe(id);
	});

	it("does NOT emit on failed update (entry not found)", async () => {
		const events: unknown[] = [];
		bus.on("knowledge.update", (payload) => events.push(payload));

		const result = await runKnowledge({ action: "update", id: "nonexistent", title: "Nope" });
		expect(result.is_error).toBe(true);
		expect(events).toHaveLength(0);
	});

	it("does NOT emit on failed delete (entry not found)", async () => {
		const events: unknown[] = [];
		bus.on("knowledge.delete", (payload) => events.push(payload));

		const result = await runKnowledge({ action: "delete", id: "nonexistent" });
		expect(result.is_error).toBe(true);
		expect(events).toHaveLength(0);
	});

	it("does NOT emit on read or search (no side effects)", async () => {
		const allEvents: unknown[] = [];
		bus.on("*", (envelope) => allEvents.push(envelope));

		await runKnowledge({ action: "list" });
		await runKnowledge({ action: "search", query: "test" });
		expect(allEvents).toHaveLength(0);
	});

	it("knowledge events work with wildcard listeners", async () => {
		const envelopes: { type: string; payload: unknown }[] = [];
		bus.on("*", (env) => envelopes.push(env));

		await runKnowledge({ action: "create", title: "Wildcard Test", content: "Test" });
		expect(envelopes).toHaveLength(1);
		expect(envelopes[0].type).toBe("knowledge.create");
	});
});
