import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { listApprovalsLocal } from "./route-helpers.js";

const queueDirs: string[] = [];

function makeQueue(): ApprovalQueue {
	const dir = mkdtempSync(`${tmpdir()}/kota-approval-review-route-`);
	queueDirs.push(dir);
	return new ApprovalQueue(dir);
}

describe("approval route review projection", () => {
	afterEach(() => {
		for (const dir of queueDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("exposes the descriptor bound to execution while durable tool I/O stays redacted", () => {
		const queue = makeQueue();
		const item = queue.enqueue(
			"shell",
			{
				command: "deploy --target /srv/app",
				args: ["replace", "--force"],
				authorization: "Bearer raw-token",
				contactEmail: "owner@example.test",
			},
			"dangerous",
			"production deployment",
			undefined,
			undefined,
			undefined,
			"user: deploy for owner@example.test with passphrase=raw-context-secret",
		);

		const listed = listApprovalsLocal(queue).approvals[0];
		expect(listed.input).toMatchObject({ redacted: true, reason: "tool-io" });
		expect(listed.review).toEqual({
			status: "available",
			input: {
				command: "deploy --target /srv/app",
				args: ["replace", "--force"],
				authorization: "[redacted]",
				contactEmail: "owner@example.test",
			},
			context: "user: deploy for owner@example.test with passphrase=[redacted]",
			digest: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(JSON.stringify(listed)).not.toContain("raw-token");

		const snapshot = queue.getExecutionSnapshot(item.id);
		if (!snapshot.ok || listed.review.status !== "available") {
			throw new Error("expected a reviewable execution snapshot");
		}
		expect(listed.review.digest).toBe(snapshot.snapshot.descriptor.reviewDigest);
	});
});
