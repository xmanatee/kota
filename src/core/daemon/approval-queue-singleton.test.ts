import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getApprovalQueue, resetApprovalQueue } from "./approval-queue.js";

describe("getApprovalQueue singleton", () => {
	afterEach(() => resetApprovalQueue());

	it("returns same instance on repeated calls", () => {
		const dir = mkdtempSync(join(tmpdir(), "approval-singleton-"));
		const q1 = getApprovalQueue(dir);
		const q2 = getApprovalQueue();
		expect(q1).toBe(q2);
		rmSync(dir, { recursive: true, force: true });
	});

	it("resets to new instance after resetApprovalQueue", () => {
		const dir1 = mkdtempSync(join(tmpdir(), "approval-reset1-"));
		const dir2 = mkdtempSync(join(tmpdir(), "approval-reset2-"));
		const q1 = getApprovalQueue(dir1);
		resetApprovalQueue();
		const q2 = getApprovalQueue(dir2);
		expect(q1).not.toBe(q2);
		rmSync(dir1, { recursive: true, force: true });
		rmSync(dir2, { recursive: true, force: true });
	});
});
