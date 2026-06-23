import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApprovalQueue } from "./approval-queue.js";

describe("ApprovalQueue MCP metadata", () => {
	let dir: string;
	let queue: ApprovalQueue;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "approval-mcp-test-"));
		queue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("stores MCP prompt declaration metadata on enqueued items", () => {
		const fingerprint = "a".repeat(64);
		const item = queue.enqueue(
			"mcp__remote__lookup",
			{ query: "status" },
			"moderate",
			"remote lookup",
			"session-123",
			undefined,
			undefined,
			undefined,
			"session-123",
			{
				server: "remote",
				tool: "lookup",
				promptDeclarationFingerprint: fingerprint,
			},
		);

		expect(item.mcpPromptDeclaration).toEqual({
			server: "remote",
			tool: "lookup",
			promptDeclarationFingerprint: fingerprint,
		});
		expect(queue.get(item.id)?.mcpPromptDeclaration).toEqual(item.mcpPromptDeclaration);
	});
});
