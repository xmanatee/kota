import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvedApprovalMatchesExecutionDescriptor } from "./approval-execution-descriptor.js";
import { ApprovalQueue } from "./approval-queue.js";

describe("ApprovalQueue execution descriptors", () => {
	let dir: string;
	let queue: ApprovalQueue;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "approval-execution-descriptor-test-"));
		queue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("binds execution to the selected tool, scope, session, input, and MCP fingerprints", () => {
		const item = queue.enqueue(
			"mcp__remote__lookup",
			{ query: "deploy" },
			"moderate",
			"reason",
			undefined,
			undefined,
			undefined,
			undefined,
			"session-123",
			{
				server: "remote",
				tool: "lookup",
				promptDeclarationFingerprint: "a".repeat(64),
				serverTransportIdentityFingerprint: "b".repeat(64),
			},
		);
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");

		const result = queue.approveForExecution(selection.snapshot.descriptor);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected execution approval");
		expect(selection.snapshot.descriptor).toMatchObject({
			approvalId: item.id,
			tool: "mcp__remote__lookup",
			scopeId: queue.getScopeId(),
			sessionId: "session-123",
			inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
			approvalSnapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
			mcpPromptDeclaration: {
				promptDeclarationFingerprint: "a".repeat(64),
				serverTransportIdentityFingerprint: "b".repeat(64),
			},
		});
		expect(approvedApprovalMatchesExecutionDescriptor(
			result.approval,
			selection.snapshot.descriptor,
		)).toBe(true);
		const declaration = result.approval.mcpPromptDeclaration;
		if (declaration === undefined) throw new Error("expected MCP declaration");
		const mismatches = [
			{ ...result.approval, tool: "shell" },
			{ ...result.approval, scopeId: "other-scope" },
			{ ...result.approval, sessionId: "other-session" },
			{ ...result.approval, input: { query: "other" } },
			{
				...result.approval,
				mcpPromptDeclaration: {
					...declaration,
					promptDeclarationFingerprint: "c".repeat(64),
				},
			},
			{
				...result.approval,
				mcpPromptDeclaration: {
					...declaration,
					serverTransportIdentityFingerprint: "d".repeat(64),
				},
			},
		];
		expect(mismatches.map((approval) => approvedApprovalMatchesExecutionDescriptor(
			approval,
			selection.snapshot.descriptor,
		))).toEqual([false, false, false, false, false, false]);
	});

	it("rejects a pending record changed after its execution snapshot was selected", () => {
		const item = queue.enqueue(
			"shell",
			{ command: "deploy" },
			"dangerous",
			"operator reviewed this reason",
		);
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");
		const stored = queue.get(item.id);
		if (!stored) throw new Error("expected stored approval");
		stored.reason = "substituted reason";
		writeFileSync(join(dir, `${item.id}.json`), JSON.stringify(stored, null, 2));

		const result = queue.approveForExecution(selection.snapshot.descriptor);

		expect(result).toMatchObject({
			ok: false,
			reason: "descriptor_mismatch",
			approval: { id: item.id, status: "pending", reason: "substituted reason" },
		});
		expect(queue.get(item.id)?.status).toBe("pending");
	});
});
