import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutonomyMode } from "./autonomy-mode.js";
import { executeToolCalls, type ToolCallExecutionOptions } from "./tool-runner.js";

const confirmActionMock = vi.hoisted(() =>
	vi.fn<(message: string) => Promise<boolean>>(),
);

vi.mock("./index.js", () => ({
	executeTool: vi.fn(),
	getToolEffect: vi.fn(() => ({
		kind: "read",
		scope: "local-fs",
		idempotent: true,
		openWorld: false,
	})),
}));
vi.mock("#core/loop/context.js", () => ({
	truncateToolResult: vi.fn((text: string) => text),
}));
vi.mock("#core/config/secrets.js", () => ({
	getSecretStore: vi.fn(() => null),
}));
vi.mock("#core/util/confirm.js", () => ({
	confirmAction: (message: string) => confirmActionMock(message),
}));

import { executeTool } from "./index.js";

const mockExecuteTool = vi.mocked(executeTool);

function toolBlock(
	name: string,
	input: Record<string, unknown> = {},
	id = "t1",
) {
	return { type: "tool_use" as const, id, name, input };
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

describe("executeToolCalls permission gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("enforces the default guardrails policy when no config is supplied", async () => {
		confirmActionMock.mockResolvedValue(false);

		const results = await executeToolCalls(
			[toolBlock("shell", { command: "rm -rf ./tmp" })],
			runOptions(),
		);

		expect(results[0].is_error).toBe(true);
		expect(results[0].content).toContain("requires confirmation");
		expect(confirmActionMock).toHaveBeenCalledWith(
			expect.stringContaining("Allow shell?"),
		);
		expect(mockExecuteTool).not.toHaveBeenCalled();
	});

	it("lets a client approval bridge satisfy an autonomous confirm-policy call", async () => {
		const clientApprovalResolver = vi.fn().mockResolvedValue({ outcome: "allow" });
		mockExecuteTool.mockResolvedValue({ content: "approved" });

		const results = await executeToolCalls(
			[toolBlock("shell", { command: "rm -rf ./tmp" }, "tool-99")],
			runOptions({ clientApprovalResolver }),
		);

		expect(results[0].content).toBe("approved");
		expect(clientApprovalResolver).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "shell",
				toolUseId: "tool-99",
				risk: "dangerous",
			}),
		);
		expect(confirmActionMock).not.toHaveBeenCalled();
		expect(mockExecuteTool).toHaveBeenCalled();
	});

	it("applies canUseTool updatedInput before executing the tool", async () => {
		const canUseTool = vi.fn().mockResolvedValue({
			behavior: "allow",
			updatedInput: { path: "/safe.txt" },
		});
		mockExecuteTool.mockResolvedValue({ content: "safe file" });

		const results = await executeToolCalls(
			[toolBlock("file_read", { path: "/unsafe.txt" }, "tool-42")],
			runOptions({ canUseTool }),
		);

		expect(canUseTool).toHaveBeenCalledWith(
			"file_read",
			{ path: "/unsafe.txt" },
			expect.objectContaining({
				signal: expect.any(AbortSignal),
				toolUseId: "tool-42",
			}),
		);
		expect(mockExecuteTool).toHaveBeenCalledWith(
			"file_read",
			{ path: "/safe.txt" },
			{ toolUseId: "tool-42" },
		);
		expect(results[0].content).toBe("safe file");
	});

	it("returns a denial result from canUseTool without executing the tool", async () => {
		const canUseTool = vi.fn().mockResolvedValue({
			behavior: "deny",
			message: "blocked by policy",
		});

		const results = await executeToolCalls(
			[toolBlock("shell", { command: "rm -rf tmp" }, "tool-42")],
			runOptions({ canUseTool }),
		);

		expect(results).toEqual([
			{
				tool_use_id: "tool-42",
				content: "blocked by policy",
				is_error: true,
			},
		]);
		expect(mockExecuteTool).not.toHaveBeenCalled();
	});
});
