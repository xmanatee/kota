import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { McpManager } from "#core/mcp/manager.js";
import { localWriteEffect } from "#core/tools/effect.js";
import {
	clearCustomTools,
	deregisterTool,
	registerTool,
	type ToolRunner,
} from "#core/tools/index.js";
import {
	ApprovalExecutionDescriptorMismatchError,
	approvedApprovalResponse,
	closeApprovalExecutionLeases,
	prepareApprovalExecutionBatch,
} from "./approval-execution.js";

const LOCAL_TOOL_NAME = "approval_local_execution_test";
const localTool: KotaTool = {
	name: LOCAL_TOOL_NAME,
	description: "Executes a reviewed local operation",
	input_schema: {
		type: "object",
		properties: { operation: { type: "string" } },
		required: ["operation"],
	},
};

function registerLocalTool(runner: ToolRunner): void {
	registerTool(
		localTool,
		runner,
		undefined,
		{ effect: localWriteEffect() },
	);
}

describe("approval execution lease", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
		clearCustomTools();
		vi.clearAllMocks();
	});

	it("rejects a descriptor mismatch immediately before tool dispatch", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kota-approval-execution-lease-"));
		dirs.push(dir);
		const queue = new ApprovalQueue(dir);
		const item = queue.enqueue(
			"shell",
			{ command: "deploy" },
			"dangerous",
			"operator reviewed shell",
			undefined,
			undefined,
			undefined,
			undefined,
			"session-123",
		);
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");
		const approved = queue.approveForExecution(selection.snapshot.descriptor);
		if (!approved.ok) throw new Error("expected approved execution snapshot");

		await expect(approvedApprovalResponse(
			{ ...approved.approval, tool: "git" },
			undefined,
			selection.snapshot.descriptor,
		)).rejects.toBeInstanceOf(ApprovalExecutionDescriptorMismatchError);
	});

	it("preserves observable descriptor metadata across local-tool preflight", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kota-approval-local-preflight-"));
		dirs.push(dir);
		registerLocalTool(vi.fn(async () => ({ content: "executed" })));
		const queue = new ApprovalQueue(dir);
		const item = queue.enqueue(
			LOCAL_TOOL_NAME,
			{ operation: "deploy" },
			"moderate",
			"reviewed",
		);
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");

		const preflight = await prepareApprovalExecutionBatch([selection.snapshot]);

		expect(preflight.ok).toBe(true);
		if (!preflight.ok) throw new Error("expected successful preflight");
		expect(preflight.leases.get(item.id)).toMatchObject(selection.snapshot.descriptor);
		await closeApprovalExecutionLeases(preflight.leases.values());
	});

	it("rejects a replacement registered under the reviewed local tool name", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kota-approval-local-replaced-"));
		dirs.push(dir);
		const reviewedRunner = vi.fn(async () => ({ content: "reviewed runner" }));
		const replacementRunner = vi.fn(async () => ({ content: "replacement runner" }));
		registerLocalTool(reviewedRunner);
		const queue = new ApprovalQueue(dir);
		const item = queue.enqueue(
			LOCAL_TOOL_NAME,
			{ operation: "deploy" },
			"moderate",
			"reviewed",
		);
		const review = queue.projectForClient(item).review;
		if (review.status !== "available") throw new Error("expected review descriptor");
		expect(review.localToolDeclaration).toEqual(item.localToolDeclaration);
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");

		deregisterTool(LOCAL_TOOL_NAME);
		registerLocalTool(replacementRunner);
		const preflight = await prepareApprovalExecutionBatch([selection.snapshot]);

		expect(preflight).toMatchObject({
			ok: false,
			status: 409,
			body: {
				reason: "local_tool_registration_changed_since_review",
				local: {
					tool: LOCAL_TOOL_NAME,
					reviewedRegistrationGeneration:
						item.localToolDeclaration?.registrationGeneration,
				},
			},
		});
		expect(queue.get(item.id)?.status).toBe("pending");
		expect(reviewedRunner).not.toHaveBeenCalled();
		expect(replacementRunner).not.toHaveBeenCalled();
	});

	it("rejects declaration drift without a registry replacement", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kota-approval-local-mutated-"));
		dirs.push(dir);
		const runner = vi.fn(async () => ({ content: "executed" }));
		registerLocalTool(runner);
		const queue = new ApprovalQueue(dir);
		const item = queue.enqueue(
			LOCAL_TOOL_NAME,
			{ operation: "deploy" },
			"moderate",
			"reviewed",
		);
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");

		localTool.description = "Changed after the operator review";
		const preflight = await prepareApprovalExecutionBatch([selection.snapshot]);

		expect(preflight).toMatchObject({
			ok: false,
			status: 409,
			body: {
				reason: "local_tool_declaration_effect_changed_since_review",
			},
		});
		expect(runner).not.toHaveBeenCalled();
		localTool.description = "Executes a reviewed local operation";
	});

	it("dispatches through the exact runner leased before a later replacement", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kota-approval-local-leased-"));
		dirs.push(dir);
		const reviewedRunner = vi.fn(async () => ({ content: "reviewed runner" }));
		const replacementRunner = vi.fn(async () => ({ content: "replacement runner" }));
		registerLocalTool(reviewedRunner);
		const queue = new ApprovalQueue(dir);
		const item = queue.enqueue(
			LOCAL_TOOL_NAME,
			{ operation: "deploy" },
			"moderate",
			"reviewed",
		);
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");
		const preflight = await prepareApprovalExecutionBatch([selection.snapshot]);
		if (!preflight.ok) throw new Error("expected successful preflight");
		const lease = preflight.leases.get(item.id);
		if (lease === undefined) throw new Error("expected local execution lease");

		deregisterTool(LOCAL_TOOL_NAME);
		registerLocalTool(replacementRunner);
		const approved = queue.approveForExecution(lease);
		if (!approved.ok) throw new Error("expected approved execution snapshot");
		await approvedApprovalResponse(approved.approval, undefined, lease);

		expect(reviewedRunner).toHaveBeenCalledWith(
			{ operation: "deploy" },
			undefined,
		);
		expect(replacementRunner).not.toHaveBeenCalled();
	});

	it("returns an explicit workflow-gate approval without tool dispatch", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kota-approval-workflow-gate-"));
		dirs.push(dir);
		const queue = new ApprovalQueue(dir);
		const item = queue.enqueueWorkflowGate({
			workflowName: "deploy",
			runId: "run-1",
			stepId: "confirm",
			reason: "approve deployment",
		});
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");
		const approved = queue.approveForExecution(selection.snapshot.descriptor);
		if (!approved.ok) throw new Error("expected approved workflow gate");

		await expect(approvedApprovalResponse(
			approved.approval,
			undefined,
			selection.snapshot.descriptor,
		)).resolves.toMatchObject({
			approval: { id: item.id, kind: "workflow_gate" },
			resolution: { kind: "workflow_gate_approved" },
		});
	});

	it("rejects MCP declaration drift through the leased manager without name-based redispatch", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kota-approval-execution-mcp-lease-"));
		dirs.push(dir);
		const queue = new ApprovalQueue(dir);
		const promptDeclarationFingerprint = "a".repeat(64);
		const item = queue.enqueue(
			"mcp__remote__lookup",
			{ query: "deploy" },
			"moderate",
			"operator reviewed MCP lookup",
			undefined,
			undefined,
			undefined,
			undefined,
			"session-123",
			{
				server: "remote",
				tool: "lookup",
				promptDeclarationFingerprint,
				serverTransportIdentityFingerprint: "b".repeat(64),
			},
		);
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");
		const approved = queue.approveForExecution(selection.snapshot.descriptor);
		if (!approved.ok) throw new Error("expected approved execution snapshot");

		const mcpManager = Object.create(McpManager.prototype) as McpManager;
		const executeBound = vi.spyOn(
			mcpManager,
			"executeToolWithDeclarationFingerprint",
		).mockResolvedValue({ ok: false, reason: "declaration_mismatch" });
		const executeByName = vi.spyOn(mcpManager, "executeTool");

		await expect(approvedApprovalResponse(
			approved.approval,
			undefined,
			{ ...selection.snapshot.descriptor, mcpManager },
		)).rejects.toBeInstanceOf(ApprovalExecutionDescriptorMismatchError);
		expect(executeBound).toHaveBeenCalledWith(
			item.tool,
			{ query: "deploy" },
			promptDeclarationFingerprint,
		);
		expect(executeByName).not.toHaveBeenCalled();
	});
});
