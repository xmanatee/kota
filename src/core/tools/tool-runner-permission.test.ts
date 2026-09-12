import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaToolUseBlock } from "#core/agent-harness/message-protocol.js";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import { localWriteEffect, readOnlyLocalEffect, type ToolEffect } from "./effect.js";
import type { ToolFilesystemTargetResolver } from "./filesystem-targets.js";
import { registerTool, type ToolRunner } from "./index.js";
import { executeToolCalls, type ToolCallExecutionOptions } from "./tool-runner.js";

const confirmActionMock = vi.hoisted(() => vi.fn<(message: string) => Promise<boolean>>());
vi.mock("#core/util/confirm.js", () => ({ confirmAction: confirmActionMock }));
const mockExecuteTool = vi.fn<ToolRunner>();
const disposers: Array<() => void> = [];
let effect: ToolEffect;

function toolBlock(name: string, input: KotaToolUseBlock["input"] = {}, id = "t1",
  resolveFilesystemTargets?: ToolFilesystemTargetResolver): KotaToolUseBlock {
  disposers.push(registerTool({ name, description: "Permission fixture",
    input_schema: { type: "object", properties: {} },
  }, mockExecuteTool, undefined, { effect, resolveFilesystemTargets }));
  return { type: "tool_use", id, name, input };
}

function runOptions(overrides: Partial<ToolCallExecutionOptions> = {}): ToolCallExecutionOptions {
  return { resultLimit: 50_000, verbose: false, autonomyMode: "autonomous", ...overrides };
}

function scopePolicy(root: string, mode: "none" | "scope-directory") {
  return resolveScopePolicy({
    projection: { rootScopeId: "global", defaultScopeId: "fixture", scopes: [
      { scopeId: "global", displayName: "Global" },
      { scopeId: "fixture", displayName: "Fixture", parentScopeId: "global", directoryRoot: root },
    ] },
    scopeId: "fixture",
    fragments: [{ scopeId: "fixture", reason: "Bounded fixture writes", writes: { mode } }],
  });
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("executeToolCalls permission gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		effect = readOnlyLocalEffect();
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
		effect = localWriteEffect();
		const policy = scopePolicy("/tmp/fixture", "none");

		const results = await executeToolCalls(
			[toolBlock("file_read", { path: "/tmp/fixture/output.txt" })],
			runOptions({ scopePolicy: policy, cwd: "/tmp/fixture" }),
		);

		expect(results[0]).toMatchObject({ is_error: true });
		expect(results[0].content).toContain("Blocked by scope policy");
		expect(results[0].content).toContain("writes are disabled");
		expect(mockExecuteTool).not.toHaveBeenCalled();
	});

	it("blocks opaque shell writes under a scope-directory boundary", async () => {
		effect = localWriteEffect();
		const policy = scopePolicy("/tmp/fixture", "scope-directory");

		const results = await executeToolCalls(
			[toolBlock("shell", {
				command: "printf escaped > /tmp/outside-fixture",
				cwd: "/tmp/fixture",
			})],
			runOptions({ scopePolicy: policy, cwd: "/tmp/fixture" }),
		);

		expect(results[0]).toMatchObject({ is_error: true });
		expect(results[0].content).toContain("does not expose a complete filesystem target");
		expect(mockExecuteTool).not.toHaveBeenCalled();
	});

	it("blocks a bounded file write whose symlinked ancestor resolves outside the scope", async () => {
		const scopeRoot = mkdtempSync(join(tmpdir(), "kota-scope-policy-project-"));
		const outsideDir = mkdtempSync(join(tmpdir(), "kota-scope-policy-outside-"));
		tempDirs.push(scopeRoot, outsideDir);
		symlinkSync(outsideDir, join(scopeRoot, "link"), "dir");
		effect = localWriteEffect();
		const policy = scopePolicy(scopeRoot, "scope-directory");

		const results = await executeToolCalls(
			[toolBlock("file_write", { path: "link/escape.txt", content: "escaped" }, "t1",
        (input, context) => typeof input.path === "string"
          ? { kind: "known", paths: [resolve(context?.cwd ?? process.cwd(), input.path)] }
          : { kind: "unknown" })],
			runOptions({ scopePolicy: policy, cwd: scopeRoot }),
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
