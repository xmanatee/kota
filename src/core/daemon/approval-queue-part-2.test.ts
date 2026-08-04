import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ApprovalQueue,
	type PendingApproval,
} from "./approval-queue.js";

function _approvePending(
	queue: ApprovalQueue,
	id: string,
	note?: string,
	resolutionSource?: string,
): PendingApproval | null {
	const selection = queue.getExecutionSnapshot(id);
	if (!selection.ok) return null;
	const result = queue.approveForExecution(
		selection.snapshot.descriptor,
		note,
		resolutionSource,
	);
	return result.ok ? result.approval : null;
}

describe("ApprovalQueue", () => {
	let dir: string;
	let queue: ApprovalQueue;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "approval-test-"));
		queue = new ApprovalQueue(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("refuses execution approval after restart when the raw input is unavailable", () => {
		const item = queue.enqueue(
			"shell",
			{ command: "deploy", accessToken: "raw-token" },
			"dangerous",
			"reason",
		);
		const restarted = new ApprovalQueue(dir);

		const result = restarted.getExecutionSnapshot(item.id);

		expect(result).toMatchObject({ ok: false, reason: "input_unavailable" });
		expect(result.ok ? undefined : result.approval?.status).toBe("pending");
		expect(restarted.get(item.id)?.status).toBe("pending");
		expect(JSON.stringify(result)).not.toContain("raw-token");
	});

	it("does not select any unavailable item for batch execution after restart", () => {
		const unavailable = queue.enqueue("shell", { command: "unavailable" }, "moderate", "reason");
		const restarted = new ApprovalQueue(dir);
		const available = restarted.enqueue("shell", { command: "available" }, "moderate", "reason");

		const unavailableSelection = restarted.getExecutionSnapshot(unavailable.id);
		const availableSelection = restarted.getExecutionSnapshot(available.id);

		expect(unavailableSelection).toMatchObject({ ok: false, reason: "input_unavailable" });
		expect(availableSelection.ok).toBe(true);
		expect(restarted.get(available.id)?.status).toBe("pending");
		expect(restarted.get(unavailable.id)?.status).toBe("pending");
	});

	it("does not store context when not provided", () => {
		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		expect(item.context).toBeUndefined();
	});});
