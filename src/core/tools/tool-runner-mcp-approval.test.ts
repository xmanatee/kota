import { describe, expect, it, vi } from "vitest";
import type { AutonomyMode } from "./autonomy-mode.js";
import { executeToolCalls, type ToolCallExecutionOptions } from "./tool-runner.js";

vi.mock("./index.js", () => ({
	executeTool: vi.fn(),
	getToolEffect: vi.fn(),
}));
vi.mock("#core/loop/context.js", () => ({
	truncateToolResult: vi.fn((text: string) => text),
}));
vi.mock("./guardrails.js", () => ({
	assess: vi.fn(),
}));
vi.mock("#core/util/confirm.js", () => ({
	confirmAction: vi.fn(),
}));
vi.mock("#core/events/event-bus.js", () => ({
	tryEmit: vi.fn(),
}));
vi.mock("#core/daemon/approval-queue.js", () => ({
	getApprovalQueue: vi.fn(() => ({
		enqueue: vi.fn(() => ({ id: "abc123" })),
	})),
}));

import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { assess } from "./guardrails.js";
import { executeTool } from "./index.js";

const mockAssess = vi.mocked(assess);
const mockExecuteTool = vi.mocked(executeTool);
const mockGetApprovalQueue = vi.mocked(getApprovalQueue);

function toolBlock(name: string, input: Record<string, unknown> = {}) {
	return { type: "tool_use" as const, id: "t1", name, input };
}

function runOptions(
	overrides: Partial<ToolCallExecutionOptions> = {},
): ToolCallExecutionOptions {
	return {
		resultLimit: 50000,
		verbose: false,
		autonomyMode: "autonomous" as AutonomyMode,
		...overrides,
	};
}

describe("tool runner MCP approval metadata", () => {
	it("persists prompt-visible MCP declaration metadata when supervised mode queues an MCP tool", async () => {
		const mockEnqueue = vi.fn(() => ({ id: "q-mcp-supervised" }));
		const promptFingerprint = "a".repeat(64);
		mockGetApprovalQueue.mockReturnValue({ enqueue: mockEnqueue } as never);
		mockAssess.mockReturnValue({
			tool: "mcp__remote__deploy",
			risk: "moderate",
			policy: "allow",
			reason: "remote write",
		});

		const results = await executeToolCalls(
			[toolBlock("mcp__remote__deploy", { target: "prod" })],
			runOptions({
				autonomyMode: "supervised",
				sessionId: "s-mcp",
				mcpManager: {
					isMcpTool: vi.fn(() => true),
					isToolReadOnly: vi.fn(() => false),
					getToolDeclarationFingerprint: vi.fn(() => promptFingerprint),
				} as never,
				mcpPromptToolDeclarationFingerprints: new Map([
					["mcp__remote__deploy", promptFingerprint],
				]),
			}),
		);

		expect(results[0].content).toContain("Queued for approval");
		expect(mockEnqueue).toHaveBeenCalledWith(
			"mcp__remote__deploy",
			{ target: "prod" },
			"moderate",
			expect.stringContaining('autonomy mode "supervised"'),
			"s-mcp",
			undefined,
			undefined,
			undefined,
			"s-mcp",
			{
				server: "remote",
				tool: "deploy",
				promptDeclarationFingerprint: promptFingerprint,
			},
		);
		expect(mockExecuteTool).not.toHaveBeenCalled();
	});
});
