import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import type { AutonomyMode } from "./autonomy-mode.js";
import { executeToolCalls, type ToolCallExecutionOptions } from "./tool-runner.js";

const confirmActionMock = vi.hoisted(() =>
	vi.fn<(message: string) => Promise<boolean>>(),
);

vi.mock("./index.js", () => ({
	executeTool: vi.fn(),
	getAllTools: vi.fn(() => ["file_read", "file_write", "shell"].map((name) => ({
		name,
		description: "test",
		input_schema: { type: "object", properties: {} },
	}))),
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
	maskKnownSecretValues: (text: string) => text,
}));
vi.mock("#core/util/confirm.js", () => ({
	confirmAction: (message: string) => confirmActionMock(message),
}));

import { executeTool, getToolEffect } from "./index.js";

const mockExecuteTool = vi.mocked(executeTool);
const mockGetToolEffect = vi.mocked(getToolEffect);
const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
		mockGetToolEffect.mockReturnValue({
			kind: "read",
			scope: "local-fs",
			idempotent: true,
			openWorld: false,
		});
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

	it("blocks a local write denied by the live scope policy before tool execution", async () => {
		mockGetToolEffect.mockReturnValue({
			kind: "write",
			scope: "local-fs",
			idempotent: false,
			openWorld: false,
		});
		const scopePolicy = resolveScopePolicy({
			projection: {
				rootScopeId: "global",
				defaultScopeId: "fixture",
				scopes: [
					{ scopeId: "global", displayName: "Global" },
					{
						scopeId: "fixture",
						displayName: "Fixture",
						parentScopeId: "global",
						directoryRoot: "/tmp/fixture",
					},
				],
			},
			scopeId: "fixture",
			fragments: [{
				scopeId: "fixture",
				reason: "Fixture is read-only.",
				writes: { mode: "none" },
			}],
		});

		const results = await executeToolCalls(
			[toolBlock("file_read", { path: "/tmp/fixture/output.txt" })],
			runOptions({ scopePolicy, cwd: "/tmp/fixture" }),
		);

		expect(results[0]).toMatchObject({ is_error: true });
		expect(results[0].content).toContain("Blocked by scope policy");
		expect(results[0].content).toContain("writes are disabled");
		expect(mockExecuteTool).not.toHaveBeenCalled();
	});

	it("blocks opaque shell writes under a scope-directory boundary", async () => {
		mockGetToolEffect.mockReturnValue({
			kind: "write",
			scope: "local-fs",
			idempotent: false,
			openWorld: false,
		});
		const scopePolicy = resolveScopePolicy({
			projection: {
				rootScopeId: "global",
				defaultScopeId: "fixture",
				scopes: [
					{ scopeId: "global", displayName: "Global" },
					{
						scopeId: "fixture",
						displayName: "Fixture",
						parentScopeId: "global",
						directoryRoot: "/tmp/fixture",
					},
				],
			},
			scopeId: "fixture",
			fragments: [{
				scopeId: "fixture",
				reason: "Fixture writes stay inside its directory.",
				writes: { mode: "scope-directory" },
			}],
		});

		const results = await executeToolCalls(
			[toolBlock("shell", {
				command: "printf escaped > /tmp/outside-fixture",
				cwd: "/tmp/fixture",
			})],
			runOptions({ scopePolicy, cwd: "/tmp/fixture" }),
		);

		expect(results[0]).toMatchObject({ is_error: true });
		expect(results[0].content).toContain("does not expose a complete filesystem target");
		expect(mockExecuteTool).not.toHaveBeenCalled();
	});

	it("blocks a bounded file write whose symlinked ancestor resolves outside the scope", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "kota-scope-policy-project-"));
		const outsideDir = mkdtempSync(join(tmpdir(), "kota-scope-policy-outside-"));
		tempDirs.push(projectDir, outsideDir);
		try {
			symlinkSync(outsideDir, join(projectDir, "link"), "dir");
		} catch {
			return;
		}
		mockGetToolEffect.mockReturnValue({
			kind: "write",
			scope: "local-fs",
			idempotent: false,
			openWorld: false,
		});
		const scopePolicy = resolveScopePolicy({
			projection: {
				rootScopeId: "global",
				defaultScopeId: "fixture",
				scopes: [
					{ scopeId: "global", displayName: "Global" },
					{
						scopeId: "fixture",
						displayName: "Fixture",
						parentScopeId: "global",
						directoryRoot: projectDir,
					},
				],
			},
			scopeId: "fixture",
			fragments: [{
				scopeId: "fixture",
				reason: "Fixture writes stay inside its real directory.",
				writes: { mode: "scope-directory" },
			}],
		});

		const results = await executeToolCalls(
			[toolBlock("file_write", { path: "link/escape.txt", content: "escaped" })],
			runOptions({ scopePolicy, cwd: projectDir }),
		);

		expect(results[0]).toMatchObject({ is_error: true });
		expect(results[0].content).toContain("outside the scope directory");
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
