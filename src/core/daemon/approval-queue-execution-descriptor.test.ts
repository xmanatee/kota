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
			reviewDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
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

	it("rejects a lease whose displayed review descriptor digest changed", () => {
		const item = queue.enqueue(
			"shell",
			{ command: "deploy", path: "/srv/app" },
			"dangerous",
			"operator reviewed this operation",
		);
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");

		const result = queue.approveForExecution({
			...selection.snapshot.descriptor,
			reviewDigest: "0".repeat(64),
		});

		expect(result).toMatchObject({
			ok: false,
			reason: "descriptor_mismatch",
			approval: { id: item.id, status: "pending" },
		});
		expect(queue.get(item.id)?.status).toBe("pending");
	});

	it("binds execution to the displayed conversation context", () => {
		const item = queue.enqueue(
			"shell",
			{ command: "deploy" },
			"dangerous",
			"operator reviewed this operation",
			undefined,
			undefined,
			undefined,
			"user: deploy production",
		);
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");

		const result = queue.approveForExecution(selection.snapshot.descriptor);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected execution approval");
		expect(result.approval.context).toBe("user: deploy production");
		expect(approvedApprovalMatchesExecutionDescriptor(
			result.approval,
			selection.snapshot.descriptor,
		)).toBe(true);
		expect(approvedApprovalMatchesExecutionDescriptor(
			{ ...result.approval, context: "user: deploy staging" },
			selection.snapshot.descriptor,
		)).toBe(false);
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

	it("keeps a descriptor batch pending when any selected record changes", () => {
		const first = queue.enqueue("shell", { command: "prepare" }, "dangerous", "first");
		const second = queue.enqueue("shell", { command: "deploy" }, "dangerous", "second");
		const firstSelection = queue.getExecutionSnapshot(first.id);
		const secondSelection = queue.getExecutionSnapshot(second.id);
		if (!firstSelection.ok || !secondSelection.ok) {
			throw new Error("expected execution snapshots");
		}
		const storedSecond = queue.get(second.id);
		if (!storedSecond) throw new Error("expected second stored approval");
		storedSecond.reason = "substituted second reason";
		writeFileSync(join(dir, `${second.id}.json`), JSON.stringify(storedSecond, null, 2));

		const result = queue.approvePendingForExecution([
			firstSelection.snapshot.descriptor,
			secondSelection.snapshot.descriptor,
		]);

		expect(result).toMatchObject({
			ok: false,
			reason: "descriptor_mismatch",
			approvals: [{ id: second.id, status: "pending" }],
		});
		expect([queue.get(first.id)?.status, queue.get(second.id)?.status]).toEqual([
			"pending",
			"pending",
		]);
	});
});
