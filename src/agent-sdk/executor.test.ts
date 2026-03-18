import { describe, expect, it, vi } from "vitest";
import type { SDKMessage, SDKModule } from "./types.js";

/** Create a mock SDK module that yields the given messages from query(). */
function mockSDK(messages: SDKMessage[]): SDKModule {
	return {
		query: () => ({
			async *[Symbol.asyncIterator]() {
				for (const m of messages) yield m;
			},
		}),
	};
}

/** Create a writable buffer for capturing output. */
function mockWriter() {
	const chunks: string[] = [];
	return {
		write(s: string) {
			chunks.push(s);
			return true;
		},
		get text() {
			return chunks.join("");
		},
	};
}

// Mock the dynamic import so tests don't require the real SDK
vi.mock("@anthropic-ai/claude-agent-sdk", () => {
	throw new Error("SDK not installed");
});

describe("AgentSDKExecutor", () => {
	describe("executeWithAgentSDK", () => {
		it("streams assistant text to writer and returns result", async () => {
			const messages: SDKMessage[] = [
				{ type: "system", sessionId: "sess-123" },
				{
					type: "assistant",
					content: [{ type: "text", text: "Hello, " }],
				},
				{
					type: "assistant",
					content: [{ type: "text", text: "world!" }],
				},
			];

			vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSDK(messages));
			const { executeWithAgentSDK } = await import("./executor.js");

			const writer = mockWriter();
			const result = await executeWithAgentSDK("test", {}, writer);

			expect(result.text).toBe("Hello, world!");
			expect(result.sessionId).toBe("sess-123");
			expect(result.turns).toBe(2);
			expect(writer.text).toBe("Hello, world!");

			vi.doUnmock("@anthropic-ai/claude-agent-sdk");
		});

		it("handles empty content blocks", async () => {
			const messages: SDKMessage[] = [
				{ type: "assistant", content: [] },
				{ type: "assistant", content: [{ type: "tool_use" }] },
				{
					type: "assistant",
					content: [{ type: "text", text: "done" }],
				},
			];

			vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSDK(messages));
			const { executeWithAgentSDK } = await import("./executor.js");

			const writer = mockWriter();
			const result = await executeWithAgentSDK("test", {}, writer);

			expect(result.text).toBe("done");
			expect(result.turns).toBe(3);
		});

		it("handles messages without content", async () => {
			const messages: SDKMessage[] = [
				{ type: "system", sessionId: "s1" },
				{ type: "status", message: "working..." },
				{ type: "assistant" },
			];

			vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSDK(messages));
			const { executeWithAgentSDK } = await import("./executor.js");

			const writer = mockWriter();
			const result = await executeWithAgentSDK("test", {}, writer);

			expect(result.text).toBe("");
			expect(result.sessionId).toBe("s1");
			expect(result.turns).toBe(1);
		});

		it("writes verbose status messages to stderr", async () => {
			const messages: SDKMessage[] = [
				{ type: "status", message: "Reading file..." },
				{
					type: "assistant",
					content: [{ type: "text", text: "result" }],
				},
			];

			vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSDK(messages));
			const { executeWithAgentSDK } = await import("./executor.js");

			const stderrSpy = vi
				.spyOn(process.stderr, "write")
				.mockReturnValue(true);
			const writer = mockWriter();

			await executeWithAgentSDK("test", { verbose: true }, writer);

			expect(stderrSpy).toHaveBeenCalledWith(
				"[agent-sdk] Reading file...\n",
			);
			stderrSpy.mockRestore();
		});

		it("does not write status messages when not verbose", async () => {
			const messages: SDKMessage[] = [
				{ type: "status", message: "Reading file..." },
				{
					type: "assistant",
					content: [{ type: "text", text: "result" }],
				},
			];

			vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSDK(messages));
			const { executeWithAgentSDK } = await import("./executor.js");

			const stderrSpy = vi
				.spyOn(process.stderr, "write")
				.mockReturnValue(true);
			const writer = mockWriter();

			await executeWithAgentSDK("test", {}, writer);

			expect(stderrSpy).not.toHaveBeenCalled();
			stderrSpy.mockRestore();
		});

		it("passes options through to SDK query", async () => {
			let capturedOpts: unknown;
			const sdk: SDKModule = {
				query: (params) => {
					capturedOpts = params;
					return {
						async *[Symbol.asyncIterator]() {
							yield {
								type: "assistant",
								content: [{ type: "text", text: "ok" }],
							};
						},
					};
				},
			};

			vi.doMock("@anthropic-ai/claude-agent-sdk", () => sdk);
			const { executeWithAgentSDK } = await import("./executor.js");

			const writer = mockWriter();
			await executeWithAgentSDK(
				"my task",
				{
					model: "claude-haiku-4-5-20251001",
					maxTurns: 10,
					maxBudgetUsd: 0.5,
					cwd: "/tmp/test",
					systemPrompt: "You are helpful.",
					allowedTools: ["Read", "Write"],
					disallowedTools: ["Bash"],
					permissionMode: "dontAsk",
				},
				writer,
			);

			const opts = capturedOpts as {
				prompt: string;
				options: Record<string, unknown>;
			};
			expect(opts.prompt).toBe("my task");
			expect(opts.options.model).toBe("claude-haiku-4-5-20251001");
			expect(opts.options.maxTurns).toBe(10);
			expect(opts.options.maxBudgetUsd).toBe(0.5);
			expect(opts.options.cwd).toBe("/tmp/test");
			expect(opts.options.systemPrompt).toBe("You are helpful.");
			expect(opts.options.allowedTools).toEqual(["Read", "Write"]);
			expect(opts.options.disallowedTools).toEqual(["Bash"]);
			expect(opts.options.permissionMode).toBe("dontAsk");

			vi.doUnmock("@anthropic-ai/claude-agent-sdk");
		});

		it("defaults maxTurns to 50 and permissionMode to bypassPermissions", async () => {
			let capturedOpts: unknown;
			const sdk: SDKModule = {
				query: (params) => {
					capturedOpts = params;
					return {
						async *[Symbol.asyncIterator]() {
							yield {
								type: "assistant",
								content: [{ type: "text", text: "ok" }],
							};
						},
					};
				},
			};

			vi.doMock("@anthropic-ai/claude-agent-sdk", () => sdk);
			const { executeWithAgentSDK } = await import("./executor.js");

			await executeWithAgentSDK("task", {}, mockWriter());

			const opts = capturedOpts as {
				options: Record<string, unknown>;
			};
			expect(opts.options.maxTurns).toBe(50);
			expect(opts.options.permissionMode).toBe("bypassPermissions");

			vi.doUnmock("@anthropic-ai/claude-agent-sdk");
		});

		it("handles multi-block assistant messages", async () => {
			const messages: SDKMessage[] = [
				{
					type: "assistant",
					content: [
						{ type: "text", text: "first " },
						{ type: "tool_use" },
						{ type: "text", text: "second" },
					],
				},
			];

			vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSDK(messages));
			const { executeWithAgentSDK } = await import("./executor.js");

			const writer = mockWriter();
			const result = await executeWithAgentSDK("test", {}, writer);

			expect(result.text).toBe("first second");
		});

		it("returns zero turns when no assistant messages", async () => {
			const messages: SDKMessage[] = [
				{ type: "system", sessionId: "s1" },
				{ type: "status", message: "initializing" },
			];

			vi.doMock("@anthropic-ai/claude-agent-sdk", () => mockSDK(messages));
			const { executeWithAgentSDK } = await import("./executor.js");

			const result = await executeWithAgentSDK("test", {}, mockWriter());

			expect(result.turns).toBe(0);
			expect(result.text).toBe("");
			expect(result.sessionId).toBe("s1");
		});
	});

	describe("loadSDK error", () => {
		it("throws helpful error when SDK is not installed", async () => {
			vi.doMock("@anthropic-ai/claude-agent-sdk", () => {
				throw new Error("Cannot find module");
			});
			const { executeWithAgentSDK } = await import("./executor.js");

			await expect(
				executeWithAgentSDK("test", {}, mockWriter()),
			).rejects.toThrow("@anthropic-ai/claude-agent-sdk is not installed");
		});
	});
});
