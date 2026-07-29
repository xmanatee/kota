import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { executeTool } from "#core/tools/index.js";
import {
	ApprovalExecutionDescriptorMismatchError,
	approvedApprovalResponse,
	closeApprovalExecutionLeases,
	prepareApprovalExecutionBatch,
} from "./approval-execution.js";

vi.mock("#core/tools/index.js", () => ({
	executeTool: vi.fn(),
}));

describe("approval execution lease", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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
		expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
	});

	it("preserves observable descriptor metadata across local-tool preflight", async () => {
		const dir = mkdtempSync(join(tmpdir(), "kota-approval-local-preflight-"));
		dirs.push(dir);
		const queue = new ApprovalQueue(dir);
		const item = queue.enqueue("shell", { command: "deploy" }, "dangerous", "reviewed");
		const selection = queue.getExecutionSnapshot(item.id);
		if (!selection.ok) throw new Error("expected execution snapshot");

		const preflight = await prepareApprovalExecutionBatch([selection.snapshot]);

		expect(preflight.ok).toBe(true);
		if (!preflight.ok) throw new Error("expected successful preflight");
		expect(preflight.leases.get(item.id)).toMatchObject(selection.snapshot.descriptor);
		await closeApprovalExecutionLeases(preflight.leases.values());
	});
});
