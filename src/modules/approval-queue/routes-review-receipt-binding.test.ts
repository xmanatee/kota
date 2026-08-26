import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { EventBus } from "#core/events/event-bus.js";
import type { ToolRunner } from "#core/tools/index.js";
import { executeApprovalStep } from "#core/workflow/steps/step-executor-approval.js";
import { createTestWorkflowRuntime } from "#core/workflow/testing/runtime-fixture.js";
import {
	clearApprovalExecutionTestTools,
	registerApprovalExecutionTestTools,
} from "./approval-execution-test-tools.integration.js";
import { handleApproveAllApprovals, handleApproveApproval } from "./routes.js";

const executeTool = vi.fn<ToolRunner>();

const queueDirs: string[] = [];

function makeQueue(): ApprovalQueue {
	const dir = mkdtempSync(`${tmpdir()}/kota-approval-receipt-binding-`);
	queueDirs.push(dir);
	return new ApprovalQueue(dir);
}

function makeRuntimeQueue(): {
	projectDir: string;
	queue: ApprovalQueue;
} {
	const projectDir = mkdtempSync(`${tmpdir()}/kota-approval-workflow-route-`);
	queueDirs.push(projectDir);
	return {
		projectDir,
		queue: new ApprovalQueue(join(projectDir, ".kota", "approvals")),
	};
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
	predicate: () => boolean,
	message: string,
	timeoutMs = 7_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await wait(10);
	}
	if (predicate()) return;
	throw new Error(message);
}

function mockRequestBody(body: Record<string, unknown>): IncomingMessage {
	const encodedBody = Buffer.from(JSON.stringify(body));
	let dataHandler: ((chunk: Buffer) => void) | undefined;
	let endHandler: (() => void) | undefined;
	return {
		headers: { "content-type": "application/json" },
		on: (event: string, callback: (data?: Buffer) => void) => {
			if (event === "data") dataHandler = callback as (chunk: Buffer) => void;
			if (event === "end") endHandler = callback as () => void;
			if (dataHandler === undefined || endHandler === undefined) return;
			dataHandler(encodedBody);
			endHandler();
			dataHandler = undefined;
			endHandler = undefined;
		},
	} as unknown as IncomingMessage;
}

function mockRequest(reviewDigest: string): IncomingMessage {
	return mockRequestBody({ reviewDigest });
}

function mockResponse(): {
	res: ServerResponse;
	result: { status: number; body: Record<string, unknown> | null };
} {
	const result: { status: number; body: Record<string, unknown> | null } = {
		status: 0,
		body: null,
	};
	const res = {
		setHeader: vi.fn(),
		writeHead: (status: number) => {
			result.status = status;
		},
		end: (data: string) => {
			result.body = JSON.parse(data) as Record<string, unknown>;
		},
		on: vi.fn(),
	} as unknown as ServerResponse;
	return { res, result };
}

function reviewDigest(queue: ApprovalQueue, id: string): string {
	const item = queue.get(id);
	if (!item) throw new Error(`Missing approval ${id}`);
	const review = queue.projectForClient(item).review;
	if (review.status !== "available") throw new Error("Expected review descriptor");
	return review.digest;
}

describe("approval review receipt binding", () => {
	beforeEach(() => {
		registerApprovalExecutionTestTools(executeTool);
	});

	afterEach(() => {
		for (const dir of queueDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		clearApprovalExecutionTestTools();
		vi.clearAllMocks();
	});

	it("rejects a receipt from another approval with identical displayed input", async () => {
		const queue = makeQueue();
		const input = { command: "deploy.sh", path: "/srv/app" };
		const first = queue.enqueue(
			"shell",
			input,
			"dangerous",
			"production deployment",
			undefined,
			undefined,
			undefined,
			"user: deploy production",
		);
		const second = queue.enqueue(
			"filesystem_write",
			input,
			"dangerous",
			"production deployment",
			undefined,
			undefined,
			undefined,
			"user: deploy production",
		);
		const { res, result } = mockResponse();

		await handleApproveApproval(
			mockRequest(reviewDigest(queue, first.id)),
			res,
			second.id,
			null,
			queue,
		);

		expect(result.status).toBe(409);
		expect(result.body).toMatchObject({
			reason: "approval_review_digest_mismatch",
			approvals: [
				{ id: second.id, tool: "filesystem_write", status: "pending" },
			],
		});
		expect(queue.get(second.id)?.status).toBe("pending");
		expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
	});

	it("resolves a workflow approval through the operator route without dispatching a pseudo-tool", async () => {
		const { projectDir, queue } = makeRuntimeQueue();
		let downstreamEffects = 0;
		const runtimeFixture = createTestWorkflowRuntime({
			bus: new EventBus(),
			projectDir,
			approvalQueue: queue,
			idleIntervalMs: 60_000,
			workflows: [
				{
					name: "route-gated-workflow",
					definitionPath: "src/modules/approval-queue/routes-review-receipt-binding.test.ts",
					moduleRoot: process.cwd(),
					repository: "none",
					triggers: [{ event: "manual", cooldownMs: 0 }],
					steps: [
						{ id: "gate", type: "approval" },
						{
							id: "downstream-effect",
							type: "code",
							run: () => {
								downstreamEffects += 1;
								return { applied: true };
							},
						},
					],
				},
			],
		});
		const { runtime } = runtimeFixture;
		runtime.start();
		try {
			const dispatch = runtime.enqueuePendingRun("route-gated-workflow");
			expect(dispatch.ok).toBe(true);
			if (dispatch.runId === undefined) throw new Error("Expected workflow run id");
			await waitUntil(
				() => queue.list("pending").length === 1,
				"Timed out waiting for workflow approval gate",
			);
			const [pending] = queue.list("pending");
			const { res, result } = mockResponse();

			await handleApproveApproval(
				mockRequest(reviewDigest(queue, pending.id)),
				res,
				pending.id,
				null,
				queue,
			);
			await waitUntil(
				() => (
					downstreamEffects === 1
					&& !runtime.isBusy()
					&& runtime.getState().workflows["route-gated-workflow"]
						?.lastCompletion?.runId === dispatch.runId
				),
				"Timed out waiting for the gated workflow to complete",
			);

			expect(result.status).toBe(200);
			expect(result.body).toMatchObject({
				approval: {
					id: pending.id,
					kind: "workflow_gate",
					status: "approved",
				},
				resolution: { kind: "workflow_gate_approved" },
			});
			expect(result.body).not.toHaveProperty("execution");
			expect(
				runtime.getState().workflows["route-gated-workflow"]?.lastCompletion,
			).toMatchObject({
				runId: dispatch.runId,
				status: "success",
			});
			await wait(100);
			expect(downstreamEffects).toBe(1);
			expect(vi.mocked(executeTool)).not.toHaveBeenCalled();
		} finally {
			await runtimeFixture.stop();
		}
	});

	it("executes only tool calls when a bulk route also resolves a workflow approval", async () => {
		vi.useFakeTimers();
		try {
			const queue = makeQueue();
			const stepPromise = executeApprovalStep(
				{ id: "gate", type: "approval" },
				{
					workflow: { name: "test-wf", runId: "run-1" },
					approvalQueue: queue,
					emit: vi.fn(),
				} as never,
				new AbortController().signal,
			);
			const gateApproval = queue.list("pending").find(
				(item) => item.kind === "workflow_gate",
			);
			if (gateApproval === undefined) throw new Error("Expected workflow gate approval");
			const toolApproval = queue.enqueue(
				"shell",
				{ command: "deploy" },
				"moderate",
				"deploy",
			);
			const reviews = queue.list("pending").map((item) => ({
				id: item.id,
				digest: reviewDigest(queue, item.id),
			}));
			executeTool.mockResolvedValue({ content: "deployed" });
			const { res, result } = mockResponse();

			await handleApproveAllApprovals(
				mockRequestBody({ reviews }),
				res,
				null,
				queue,
			);
			await vi.advanceTimersByTimeAsync(2_000);

			expect(result.status).toBe(200);
			expect(result.body).toMatchObject({
				count: 2,
				resolutions: [
					{
						approvalId: gateApproval.id,
						resolution: { kind: "workflow_gate_approved" },
					},
					{
						approvalId: toolApproval.id,
						resolution: {
							kind: "tool_execution",
							execution: { status: "succeeded" },
						},
					},
				],
			});
			await expect(stepPromise).resolves.toMatchObject({ approved: true });
			expect(vi.mocked(executeTool)).toHaveBeenCalledOnce();
			expect(vi.mocked(executeTool)).toHaveBeenCalledWith(
				{ command: "deploy" },
				undefined,
			);
		} finally {
			vi.useRealTimers();
		}
	});
});
