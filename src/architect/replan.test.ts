import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { ModelClient } from "../model/model-client.js";
import {
	buildExecutionSummary,
	buildReplanPrompt,
	createFailureTracker,
	detectReplanTrigger,
	invokeReplanner,
	parseReplanDecision,
	recordStep,
} from "./replan.js";

// --- createFailureTracker ---

describe("createFailureTracker", () => {
	it("initializes with zeroed counters", () => {
		const t = createFailureTracker();
		expect(t.consecutiveErrors).toBe(0);
		expect(t.recentErrors).toEqual([]);
		expect(t.totalSteps).toBe(0);
		expect(t.replanCount).toBe(0);
	});
});

// --- recordStep ---

describe("recordStep", () => {
	it("increments totalSteps on success", () => {
		const t = createFailureTracker();
		recordStep(t, { tool: "file_read", error: null });
		expect(t.totalSteps).toBe(1);
		expect(t.consecutiveErrors).toBe(0);
	});

	it("increments consecutiveErrors on failure", () => {
		const t = createFailureTracker();
		recordStep(t, { tool: "file_edit", error: "not found" });
		expect(t.consecutiveErrors).toBe(1);
		expect(t.recentErrors).toEqual([{ tool: "file_edit", error: "not found" }]);
	});

	it("resets consecutiveErrors after a success", () => {
		const t = createFailureTracker();
		recordStep(t, { tool: "shell", error: "exit 1" });
		recordStep(t, { tool: "shell", error: "exit 1" });
		expect(t.consecutiveErrors).toBe(2);
		recordStep(t, { tool: "file_read", error: null });
		expect(t.consecutiveErrors).toBe(0);
		expect(t.totalSteps).toBe(3);
	});

	it("accumulates recentErrors across failures", () => {
		const t = createFailureTracker();
		recordStep(t, { tool: "a", error: "e1" });
		recordStep(t, { tool: "b", error: null });
		recordStep(t, { tool: "c", error: "e2" });
		expect(t.recentErrors).toHaveLength(2);
	});
});

// --- detectReplanTrigger ---

describe("detectReplanTrigger", () => {
	it("returns null when no failures", () => {
		const t = createFailureTracker();
		recordStep(t, { tool: "file_read", error: null });
		expect(detectReplanTrigger(t)).toBeNull();
	});

	it("returns null for fewer than 3 consecutive errors", () => {
		const t = createFailureTracker();
		recordStep(t, { tool: "a", error: "e" });
		recordStep(t, { tool: "b", error: "e" });
		expect(detectReplanTrigger(t)).toBeNull();
	});

	it("returns consecutive-errors after 3 consecutive failures", () => {
		const t = createFailureTracker();
		recordStep(t, { tool: "a", error: "e1" });
		recordStep(t, { tool: "b", error: "e2" });
		recordStep(t, { tool: "c", error: "e3" });
		expect(detectReplanTrigger(t)).toBe("consecutive-errors");
	});

	it("returns stagnation when same tool+error repeats", () => {
		const t = createFailureTracker();
		recordStep(t, { tool: "file_edit", error: "old_string not found" });
		recordStep(t, { tool: "file_edit", error: "old_string not found" });
		expect(detectReplanTrigger(t)).toBe("stagnation");
	});

	it("does not detect stagnation with different errors", () => {
		const t = createFailureTracker();
		recordStep(t, { tool: "file_edit", error: "not found" });
		recordStep(t, { tool: "file_edit", error: "different error" });
		expect(detectReplanTrigger(t)).toBeNull();
	});

	it("returns null when max replans reached", () => {
		const t = createFailureTracker();
		t.replanCount = 2;
		recordStep(t, { tool: "a", error: "e" });
		recordStep(t, { tool: "a", error: "e" });
		recordStep(t, { tool: "a", error: "e" });
		expect(detectReplanTrigger(t)).toBeNull();
	});

	it("stagnation detection uses last N errors, not all errors", () => {
		const t = createFailureTracker();
		recordStep(t, { tool: "a", error: "different" });
		recordStep(t, { tool: "b", error: null }); // resets consecutive
		recordStep(t, { tool: "file_edit", error: "same" });
		recordStep(t, { tool: "file_edit", error: "same" });
		expect(detectReplanTrigger(t)).toBe("stagnation");
	});
});

// --- buildReplanPrompt ---

describe("buildReplanPrompt", () => {
	it("includes original plan", () => {
		const prompt = buildReplanPrompt("Step 1: Do X", "→ shell failed", "consecutive-errors");
		expect(prompt).toContain("Step 1: Do X");
	});

	it("includes execution summary", () => {
		const prompt = buildReplanPrompt("plan", "→ shell(ls)\n  ERROR: not found", "stagnation");
		expect(prompt).toContain("ERROR: not found");
	});

	it("describes consecutive-errors trigger", () => {
		const prompt = buildReplanPrompt("plan", "summary", "consecutive-errors");
		expect(prompt).toContain("Multiple consecutive tool calls have failed");
	});

	it("describes stagnation trigger", () => {
		const prompt = buildReplanPrompt("plan", "summary", "stagnation");
		expect(prompt).toContain("same error is repeating");
	});

	it("offers three decisions", () => {
		const prompt = buildReplanPrompt("plan", "summary", "consecutive-errors");
		expect(prompt).toContain("DECISION: CONTINUE");
		expect(prompt).toContain("DECISION: REVISE");
		expect(prompt).toContain("DECISION: ABORT");
	});
});

// --- parseReplanDecision ---

describe("parseReplanDecision", () => {
	it("parses CONTINUE", () => {
		expect(parseReplanDecision("DECISION: CONTINUE")).toEqual({ action: "continue" });
	});

	it("parses REVISE with plan", () => {
		const result = parseReplanDecision("DECISION: REVISE\n1. Read the file\n2. Edit differently");
		expect(result).toEqual({
			action: "revise",
			plan: "1. Read the file\n2. Edit differently",
		});
	});

	it("parses ABORT with reason", () => {
		const result = parseReplanDecision("DECISION: ABORT\nThe file does not exist.");
		expect(result).toEqual({ action: "abort", reason: "The file does not exist." });
	});

	it("truncates long abort reasons", () => {
		const longReason = "x".repeat(600);
		const result = parseReplanDecision(`DECISION: ABORT\n${longReason}`);
		expect(result.action).toBe("abort");
		expect((result as { reason: string }).reason.length).toBeLessThanOrEqual(500);
	});

	it("falls back to continue for REVISE without plan text", () => {
		expect(parseReplanDecision("DECISION: REVISE")).toEqual({ action: "continue" });
	});

	it("falls back to revise for plan-like text without explicit decision", () => {
		const result = parseReplanDecision("Step 1: Try alternative\nStep 2: Verify");
		expect(result.action).toBe("revise");
	});

	it("falls back to continue for unstructured text", () => {
		expect(parseReplanDecision("Everything looks fine.")).toEqual({ action: "continue" });
	});

	it("handles ABORT before REVISE in mixed text", () => {
		const result = parseReplanDecision("Analysis: DECISION: ABORT\nCannot proceed. DECISION: REVISE");
		expect(result.action).toBe("abort");
	});

	it("recognizes numbered-list format as plan", () => {
		const result = parseReplanDecision("1. First step\n2. Second step");
		expect(result.action).toBe("revise");
	});

	it("recognizes bullet-list format as plan", () => {
		const result = parseReplanDecision("- Do this\n- Then that");
		expect(result.action).toBe("revise");
	});
});

// --- buildExecutionSummary ---

describe("buildExecutionSummary", () => {
	it("returns empty string for empty messages", () => {
		expect(buildExecutionSummary([])).toBe("");
	});

	it("extracts tool_use and tool_result pairs", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "t1", name: "file_read", input: { path: "a.ts" } }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "t1", content: "file contents" }],
			},
		];
		const summary = buildExecutionSummary(messages);
		expect(summary).toContain("file_read");
		expect(summary).toContain("OK: file contents");
	});

	it("marks errors with ERROR prefix", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "t1", content: "not found", is_error: true }],
			},
		];
		const summary = buildExecutionSummary(messages);
		expect(summary).toContain("ERROR: not found");
	});

	it("limits entries to maxEntries", () => {
		const messages: Anthropic.Messages.MessageParam[] = [];
		for (let i = 0; i < 20; i++) {
			messages.push({
				role: "assistant",
				content: [{ type: "tool_use", id: `t${i}`, name: "shell", input: { command: `cmd${i}` } }],
			});
			messages.push({
				role: "user",
				content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `result${i}` }],
			});
		}
		const summary = buildExecutionSummary(messages, 5);
		// 5 entries × 2 lines each (tool_use + tool_result) = 10 lines
		const lines = summary.split("\n");
		expect(lines.length).toBeLessThanOrEqual(10);
	});

	it("skips string-content messages", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "Execute the plan" },
		];
		expect(buildExecutionSummary(messages)).toBe("");
	});

	it("truncates long tool inputs", () => {
		const longInput = { path: "x".repeat(200) };
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "t1", name: "file_read", input: longInput }],
			},
		];
		const summary = buildExecutionSummary(messages);
		expect(summary.length).toBeLessThan(200);
	});
});

// --- invokeReplanner ---

describe("invokeReplanner", () => {
	function mockClient(responseText: string) {
		return {
			messages: {
				stream: vi.fn(),
				create: vi.fn().mockResolvedValue({
					content: [{ type: "text", text: responseText }],
					usage: { input_tokens: 100, output_tokens: 50 },
				}),
			},
		} as unknown as ModelClient & { messages: { create: ReturnType<typeof vi.fn> } };
	}

	it("returns continue decision", async () => {
		const client = mockClient("DECISION: CONTINUE");
		const result = await invokeReplanner({
			client,
			model: "test",
			maxTokens: 1000,
			originalPlan: "plan",
			messages: [],
			trigger: "consecutive-errors",
		});
		expect(result).toEqual({ action: "continue" });
	});

	it("returns revise decision with plan", async () => {
		const client = mockClient("DECISION: REVISE\n1. New step\n2. Another step");
		const result = await invokeReplanner({
			client,
			model: "test",
			maxTokens: 1000,
			originalPlan: "old plan",
			messages: [],
			trigger: "stagnation",
		});
		expect(result.action).toBe("revise");
		expect((result as { plan: string }).plan).toContain("New step");
	});

	it("returns abort decision", async () => {
		const client = mockClient("DECISION: ABORT\nFile system is read-only");
		const result = await invokeReplanner({
			client,
			model: "test",
			maxTokens: 1000,
			originalPlan: "plan",
			messages: [],
			trigger: "consecutive-errors",
		});
		expect(result).toEqual({ action: "abort", reason: "File system is read-only" });
	});

	it("tracks cost via costTracker", async () => {
		const client = mockClient("DECISION: CONTINUE");
		const costTracker = { addUsage: vi.fn() };
		await invokeReplanner({
			client,
			model: "test-model",
			maxTokens: 1000,
			originalPlan: "plan",
			messages: [],
			trigger: "consecutive-errors",
			costTracker: costTracker as unknown as import("../core/loop/cost.js").CostTracker,
		});
		expect(costTracker.addUsage).toHaveBeenCalledWith("test-model", expect.objectContaining({
			input_tokens: 100,
		}));
	});

	it("passes original plan and trigger in prompt", async () => {
		const client = mockClient("DECISION: CONTINUE");
		await invokeReplanner({
			client,
			model: "test",
			maxTokens: 1000,
			originalPlan: "Build the widget",
			messages: [],
			trigger: "stagnation",
		});
		const callArgs = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(callArgs.messages[0].content).toContain("Build the widget");
		expect(callArgs.messages[0].content).toContain("same error is repeating");
	});
});
