import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EventBus, initEventBus, resetEventBus } from "../event-bus.js";
import { runKnowledge } from "../tools/knowledge.js";
import { KnowledgeStore, resetKnowledgeStore } from "./knowledge-store.js";

describe("knowledge events", () => {
	let tmpDir: string;
	let bus: EventBus;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "kota-kev-"));
		// Initialize event bus so tryEmit works
		bus = initEventBus();
		// Set up knowledge store with tmp project dir
		resetKnowledgeStore();
		// We need the store to use our tmpDir — the tool calls getKnowledgeStore()
		// which uses process.cwd(). Override by creating a .kota/data/ in tmpDir
		// and temporarily changing cwd.
	});

	afterEach(() => {
		resetEventBus();
		resetKnowledgeStore();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("emits knowledge.create on successful create", async () => {
		const events: { id: string; title: string; type: string; tags: string[]; scope: string }[] = [];
		bus.on("knowledge.create", (payload) => events.push(payload));

		const cwd = process.cwd();
		process.chdir(tmpDir);
		try {
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
		} finally {
			process.chdir(cwd);
		}
	});

	it("emits knowledge.update on successful update", async () => {
		const events: { id: string; fields: string[] }[] = [];
		bus.on("knowledge.update", (payload) => events.push(payload));

		const cwd = process.cwd();
		process.chdir(tmpDir);
		try {
			// Create first
			const store = new KnowledgeStore(tmpDir);
			const id = store.create({ title: "Updatable", content: "Original" });

			// Update via tool
			resetKnowledgeStore();
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
		} finally {
			process.chdir(cwd);
		}
	});

	it("emits knowledge.delete on successful delete", async () => {
		const events: { id: string }[] = [];
		bus.on("knowledge.delete", (payload) => events.push(payload));

		const cwd = process.cwd();
		process.chdir(tmpDir);
		try {
			// Create first
			const store = new KnowledgeStore(tmpDir);
			const id = store.create({ title: "Deletable", content: "Will be deleted" });

			// Delete via tool
			resetKnowledgeStore();
			const result = await runKnowledge({ action: "delete", id });
			expect(result.is_error).toBeUndefined();
			expect(events).toHaveLength(1);
			expect(events[0].id).toBe(id);
		} finally {
			process.chdir(cwd);
		}
	});

	it("does NOT emit on failed update (entry not found)", async () => {
		const events: unknown[] = [];
		bus.on("knowledge.update", (payload) => events.push(payload));

		const cwd = process.cwd();
		process.chdir(tmpDir);
		try {
			const result = await runKnowledge({ action: "update", id: "nonexistent", title: "Nope" });
			expect(result.is_error).toBe(true);
			expect(events).toHaveLength(0);
		} finally {
			process.chdir(cwd);
		}
	});

	it("does NOT emit on failed delete (entry not found)", async () => {
		const events: unknown[] = [];
		bus.on("knowledge.delete", (payload) => events.push(payload));

		const cwd = process.cwd();
		process.chdir(tmpDir);
		try {
			const result = await runKnowledge({ action: "delete", id: "nonexistent" });
			expect(result.is_error).toBe(true);
			expect(events).toHaveLength(0);
		} finally {
			process.chdir(cwd);
		}
	});

	it("does NOT emit on read or search (no side effects)", async () => {
		const allEvents: unknown[] = [];
		bus.on("*", (envelope) => allEvents.push(envelope));

		const cwd = process.cwd();
		process.chdir(tmpDir);
		try {
			await runKnowledge({ action: "list" });
			await runKnowledge({ action: "search", query: "test" });
			expect(allEvents).toHaveLength(0);
		} finally {
			process.chdir(cwd);
		}
	});

	it("knowledge events work with wildcard listeners", async () => {
		const envelopes: { type: string; payload: unknown }[] = [];
		bus.on("*", (env) => envelopes.push(env));

		const cwd = process.cwd();
		process.chdir(tmpDir);
		try {
			await runKnowledge({ action: "create", title: "Wildcard Test", content: "Test" });
			expect(envelopes).toHaveLength(1);
			expect(envelopes[0].type).toBe("knowledge.create");
		} finally {
			process.chdir(cwd);
		}
	});
});
