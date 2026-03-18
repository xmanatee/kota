import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKMessage, SDKModule } from "../agent-sdk/types.js";
import type { CostTracker } from "../cost.js";
import type { Transport } from "../transport.js";

function makeSDK(messages: SDKMessage[]): SDKModule {
	return {
		query: () => ({
			async *[Symbol.asyncIterator]() {
				for (const m of messages) yield m;
			},
		}),
	};
}

function mockTransport(): Transport & {
	messages: Array<{ type: string; message?: string }>;
} {
	const messages: Array<{ type: string; message?: string }> = [];
	return {
		messages,
		emit(event: unknown) {
			messages.push(event as { type: string; message?: string });
		},
		on: vi.fn(),
		off: vi.fn(),
	} as unknown as Transport & {
		messages: Array<{ type: string; message?: string }>;
	};
}

// Static mock — hoisted by vitest, stable across worker pools
const mockLoadSDK = vi.fn<[], Promise<SDKModule>>();
vi.mock("../agent-sdk/index.js", () => ({
	loadSDK: (...args: []) => mockLoadSDK(...args),
}));

// Import after mock is set up (static mock is hoisted)
const { runDelegateAgentSDK } = await import("./delegate-agent-sdk.js");

describe("delegate-agent-sdk", () => {
	beforeEach(() => {
		mockLoadSDK.mockReset();
	});

	it("returns error when SDK is not installed", async () => {
		mockLoadSDK.mockRejectedValue(new Error("SDK not installed"));

		const result = await runDelegateAgentSDK("fix bug", "execute", {});

		expect(result.is_error).toBe(true);
		expect(result.content).toContain("Agent SDK not available");
	});

	it("streams assistant text and returns formatted result", async () => {
		mockLoadSDK.mockResolvedValue(
			makeSDK([
				{ type: "system", sessionId: "sess-abc" },
				{
					type: "assistant",
					content: [{ type: "text", text: "Working on it..." }],
				},
				{
					type: "result",
					result: "Fixed the bug in auth.ts",
					num_turns: 3,
					total_cost_usd: 0.02,
					subtype: "success",
				},
			]),
		);

		const transport = mockTransport();
		const result = await runDelegateAgentSDK("fix auth bug", "execute", {
			transport,
		});

		expect(result.is_error).toBeUndefined();
		expect(result.content).toContain("Fixed the bug in auth.ts");
		expect(result.content).toContain("agent-sdk");
	});

	it("reports turn_limit when SDK hits max turns", async () => {
		mockLoadSDK.mockResolvedValue(
			makeSDK([
				{
					type: "result",
					result: "Ran out of turns",
					subtype: "error_max_turns",
					num_turns: 25,
				},
			]),
		);

		const result = await runDelegateAgentSDK(
			"refactor entire codebase",
			"execute",
			{},
		);

		expect(result.content).toContain("hit turn limit");
	});

	it("reports circuit_break on budget exceeded", async () => {
		mockLoadSDK.mockResolvedValue(
			makeSDK([
				{
					type: "result",
					result: "Budget exceeded",
					subtype: "error_max_budget_usd",
					num_turns: 10,
					total_cost_usd: 0.5,
				},
			]),
		);

		const result = await runDelegateAgentSDK("complex task", "execute", {});

		expect(result.content).toContain("stopped");
	});

	it("reports circuit_break on execution error", async () => {
		mockLoadSDK.mockResolvedValue(
			makeSDK([
				{
					type: "result",
					result: "Error occurred",
					subtype: "error_during_execution",
					num_turns: 5,
				},
			]),
		);

		const result = await runDelegateAgentSDK("task", "execute", {});

		expect(result.content).toContain("stopped");
	});

	it("tracks cost via costTracker.addRawCost", async () => {
		mockLoadSDK.mockResolvedValue(
			makeSDK([
				{
					type: "result",
					result: "Done",
					total_cost_usd: 0.15,
					subtype: "success",
				},
			]),
		);

		const addRawCost = vi.fn();
		const costTracker = { addRawCost } as unknown as CostTracker;
		await runDelegateAgentSDK("task", "execute", { costTracker });

		expect(addRawCost).toHaveBeenCalledWith(0.15);
	});

	it("passes correct SDK options for explore mode", async () => {
		let capturedOpts: unknown;
		const sdk: SDKModule = {
			query: (params) => {
				capturedOpts = params;
				return {
					async *[Symbol.asyncIterator]() {
						yield {
							type: "result",
							result: "Found it",
							subtype: "success",
						} as SDKMessage;
					},
				};
			},
		};
		mockLoadSDK.mockResolvedValue(sdk);

		await runDelegateAgentSDK("find all API endpoints", "explore", {
			cwd: "/tmp/project",
			model: "claude-haiku-4-5-20251001",
		});

		const opts = capturedOpts as {
			prompt: string;
			options: Record<string, unknown>;
		};
		expect(opts.prompt).toBe("find all API endpoints");
		expect(opts.options.cwd).toBe("/tmp/project");
		expect(opts.options.model).toBe("claude-haiku-4-5-20251001");
		expect(opts.options.permissionMode).toBe("bypassPermissions");
		expect(opts.options.maxTurns).toBe(15);
		const allowed = opts.options.allowedTools as string[];
		expect(allowed).toContain("Read");
		expect(allowed).toContain("Grep");
		expect(allowed).not.toContain("Edit");
		expect(allowed).not.toContain("Write");
	});

	it("passes correct SDK options for execute mode", async () => {
		let capturedOpts: unknown;
		const sdk: SDKModule = {
			query: (params) => {
				capturedOpts = params;
				return {
					async *[Symbol.asyncIterator]() {
						yield {
							type: "result",
							result: "Done",
							subtype: "success",
						} as SDKMessage;
					},
				};
			},
		};
		mockLoadSDK.mockResolvedValue(sdk);

		await runDelegateAgentSDK("fix the type error", "execute", {
			cwd: "/tmp/project",
			maxBudgetUsd: 1.0,
		});

		const opts = capturedOpts as { options: Record<string, unknown> };
		expect(opts.options.maxTurns).toBe(25);
		expect(opts.options.maxBudgetUsd).toBe(1.0);
		const allowed = opts.options.allowedTools as string[];
		expect(allowed).toContain("Edit");
		expect(allowed).toContain("Write");
		expect(allowed).toContain("Bash");
	});

	it("emits status messages to transport", async () => {
		mockLoadSDK.mockResolvedValue(
			makeSDK([
				{ type: "system", sessionId: "sess-xyz" },
				{
					type: "assistant",
					content: [{ type: "text", text: "working" }],
				},
				{
					type: "result",
					result: "Done",
					subtype: "success",
					num_turns: 2,
				},
			]),
		);

		const transport = mockTransport();
		await runDelegateAgentSDK("task", "explore", { transport });

		const statusMessages = transport.messages.filter(
			(m) => m.type === "status",
		);
		expect(statusMessages.length).toBeGreaterThanOrEqual(2);
		expect(statusMessages[0].message).toContain("agent-sdk");
		expect(statusMessages[0].message).toContain("starting");
		expect(statusMessages[statusMessages.length - 1].message).toContain(
			"done",
		);
	});

	it("uses result text from result message, not accumulated text", async () => {
		mockLoadSDK.mockResolvedValue(
			makeSDK([
				{
					type: "assistant",
					content: [{ type: "text", text: "intermediate thinking" }],
				},
				{
					type: "result",
					result: "Final answer here",
					subtype: "success",
					num_turns: 1,
				},
			]),
		);

		const result = await runDelegateAgentSDK("question", "explore", {});

		expect(result.content).toContain("Final answer here");
		expect(result.content).not.toContain("intermediate thinking");
	});

	it("defaults budget to 0.5 USD when not specified", async () => {
		let capturedOpts: unknown;
		const sdk: SDKModule = {
			query: (params) => {
				capturedOpts = params;
				return {
					async *[Symbol.asyncIterator]() {
						yield {
							type: "result",
							result: "ok",
							subtype: "success",
						} as SDKMessage;
					},
				};
			},
		};
		mockLoadSDK.mockResolvedValue(sdk);

		await runDelegateAgentSDK("task", "execute", {});

		const opts = capturedOpts as { options: Record<string, unknown> };
		expect(opts.options.maxBudgetUsd).toBe(0.5);
	});

	it("handles empty result gracefully", async () => {
		mockLoadSDK.mockResolvedValue(
			makeSDK([{ type: "result", subtype: "success" }]),
		);

		const result = await runDelegateAgentSDK("task", "explore", {});

		expect(result.content).toContain("without producing a response");
	});
});
