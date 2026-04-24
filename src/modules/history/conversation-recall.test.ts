import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	initProviderRegistry,
	resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { runConversationRecall } from "./conversation-recall.js";
import { ConversationHistory } from "./history.js";

describe("runConversationRecall", () => {
	let history: ConversationHistory;

	beforeEach(() => {
		const dir = mkdtempSync(join(tmpdir(), "kota-recall-test-"));
		history = new ConversationHistory(dir);
		const registry = initProviderRegistry();
		registry.register("history", "test", history);
	});

	afterEach(() => {
		resetProviderRegistry();
	});

	describe("list", () => {
		it("returns message when no conversations", async () => {
			const result = await runConversationRecall({ action: "list" });
			expect(result.content).toBe("No conversations in history.");
		});

		it("lists recent conversations", async () => {
			const id = history.create("claude-haiku", "/tmp/test");
			history.save(
				id,
				[
					{ role: "user", content: "Hello" },
					{ role: "assistant", content: "Hi there!" },
				],
				0,
				0,
			);

			const result = await runConversationRecall({ action: "list" });
			expect(result.content).toContain("1 recent conversation(s)");
			expect(result.content).toContain("Hello");
			expect(result.content).toContain(id);
		});

		it("respects limit parameter", async () => {
			for (let i = 0; i < 5; i++) {
				const id = history.create("claude-haiku", "/tmp/test");
				history.save(
					id,
					[{ role: "user", content: `Message ${i}` }],
					0,
					0,
				);
			}

			const result = await runConversationRecall({
				action: "list",
				limit: 2,
			});
			expect(result.content).toContain("2 recent conversation(s)");
		});
	});

	describe("search", () => {
		it("requires query parameter", async () => {
			const result = await runConversationRecall({ action: "search" });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("query is required");
		});

		it("returns message when no matches", async () => {
			const result = await runConversationRecall({
				action: "search",
				query: "nonexistent-xyz-abc",
			});
			expect(result.content).toBe("No matching conversations found.");
		});

		it("finds conversations by title content", async () => {
			const id = history.create("claude-haiku", "/tmp/test");
			history.save(
				id,
				[
					{
						role: "user",
						content: "Help me fix the authentication bug",
					},
				],
				0,
				0,
			);

			const result = await runConversationRecall({
				action: "search",
				query: "authentication",
			});
			expect(result.content).toContain("authentication");
			expect(result.content).toContain(id);
		});
	});

	describe("read", () => {
		it("requires id parameter", async () => {
			const result = await runConversationRecall({ action: "read" });
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("id is required");
		});

		it("returns error for nonexistent conversation", async () => {
			const result = await runConversationRecall({
				action: "read",
				id: "nonexistent",
			});
			expect(result.is_error).toBe(true);
			expect(result.content).toContain("not found");
		});

		it("reads conversation messages", async () => {
			const id = history.create("claude-haiku", "/tmp/test");
			history.save(
				id,
				[
					{ role: "user", content: "What is TypeScript?" },
					{
						role: "assistant",
						content: "TypeScript is a typed superset of JavaScript.",
					},
				],
				0,
				0,
			);

			const result = await runConversationRecall({
				action: "read",
				id,
			});
			expect(result.content).toContain("What is TypeScript?");
			expect(result.content).toContain(
				"TypeScript is a typed superset of JavaScript",
			);
			expect(result.content).toContain("**User**:");
			expect(result.content).toContain("**Assistant**:");
		});

		it("resolves conversation by ID prefix", async () => {
			const id = history.create("claude-haiku", "/tmp/test");
			history.save(
				id,
				[{ role: "user", content: "prefix test" }],
				0,
				0,
			);

			const prefix = id.slice(0, 6);
			const result = await runConversationRecall({
				action: "read",
				id: prefix,
			});
			expect(result.is_error).toBeUndefined();
			expect(result.content).toContain("prefix test");
		});

		it("truncates long messages", async () => {
			const id = history.create("claude-haiku", "/tmp/test");
			const longMessage = "A".repeat(1000);
			history.save(
				id,
				[{ role: "user", content: longMessage }],
				0,
				0,
			);

			const result = await runConversationRecall({
				action: "read",
				id,
			});
			expect(result.content).toContain("...");
			expect(result.content!.length).toBeLessThan(longMessage.length);
		});

		it("shows header with metadata", async () => {
			const id = history.create("claude-haiku", "/tmp/test");
			history.save(
				id,
				[
					{ role: "user", content: "Hello" },
					{ role: "assistant", content: "Hi" },
				],
				0,
				0,
			);

			const result = await runConversationRecall({
				action: "read",
				id,
			});
			expect(result.content).toContain("Conversation:");
			expect(result.content).toContain(`ID: ${id}`);
			expect(result.content).toContain("Messages:");
		});
	});

	it("returns error for unknown action", async () => {
		const result = await runConversationRecall({ action: "bogus" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("unknown action");
	});
});
