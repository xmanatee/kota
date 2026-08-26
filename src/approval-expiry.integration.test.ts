/**
 * Integration test: ApprovalQueue expiry × EventBus
 *
 * Verifies that approval.expired is emitted through the real event bus when
 * expireStale runs, with both global defaultTtlMs and per-item timeoutMs.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalQueue } from "./core/daemon/approval-queue.js";
import { subscribeDaemon } from "./core/daemon/daemon-subscriptions.js";
import {
	resetOwnerQuestionQueue,
	setOwnerQuestionQueueInstance,
} from "./core/daemon/owner-question-queue.js";
import {
	resetScheduler,
	setSchedulerInstance,
} from "./core/daemon/scheduler.js";
import { buildDirectoryScope } from "./core/daemon/scope-registry.js";
import type { ScopeRuntime } from "./core/daemon/scope-runtime.js";
import { getEventBus, initEventBus, resetEventBus } from "./core/events/event-bus.js";
import { ScopedEventBus } from "./core/events/scope.js";
import type { ToolRunner } from "./core/tools/index.js";
import {
	clearApprovalExecutionTestTools,
	registerApprovalExecutionTestTools,
} from "./modules/approval-queue/approval-execution-test-tools.integration.js";
import { handleApproveApproval } from "./modules/approval-queue/routes.js";
import { createTestScopeRuntime as createIsolatedScopeRuntime } from "./modules/autonomy/autonomy-runtime.test-helpers.js";

const TEST_SCOPE_ID = "test-scope";

describe("approval expiry × event bus integration", () => {
	let dir: string;
	let queue: ApprovalQueue;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-31T00:00:00.000Z"));
		dir = mkdtempSync(join(tmpdir(), "approval-expiry-integration-"));
		resetEventBus();
		const bus = initEventBus();
		const pbus = new ScopedEventBus(bus, TEST_SCOPE_ID);
		queue = new ApprovalQueue(dir, pbus);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		clearApprovalExecutionTestTools();
		resetOwnerQuestionQueue();
		resetScheduler();
		resetEventBus();
		vi.useRealTimers();
	});

	function agePendingApproval(ageMs: number): void {
		vi.advanceTimersByTime(ageMs);
	}

	it("emits approval.expired on the bus when global TTL expires an item", () => {
		const bus = getEventBus()!;
		const received: unknown[] = [];
		bus.on("approval.expired", (payload) => received.push(payload));

		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		agePendingApproval(2000);

		queue.expireStale(1000);

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({
			scopeId: TEST_SCOPE_ID,
			id: item.id,
			tool: item.tool,
		});
	});

	it("emits approval.expired on the bus when per-item timeoutMs expires", () => {
		const bus = getEventBus()!;
		const received: unknown[] = [];
		bus.on("approval.expired", (payload) => received.push(payload));

		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500);
		agePendingApproval(2000);

		// No defaultTtlMs — relies entirely on per-item timeout
		queue.expireStale();

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({
			scopeId: TEST_SCOPE_ID,
			id: item.id,
			tool: item.tool,
		});
	});

	it("does not emit approval.expired for items within TTL", () => {
		const bus = getEventBus()!;
		const received: unknown[] = [];
		bus.on("approval.expired", (payload) => received.push(payload));

		queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		// Do NOT backdate — item is fresh

		queue.expireStale(60_000);

		expect(received).toHaveLength(0);
	});

	it("emits workflow.approval.timeout on the bus for auto-deny", () => {
		const bus = getEventBus()!;
		const received: unknown[] = [];
		bus.on("workflow.approval.timeout", (payload) => received.push(payload));

		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason");
		agePendingApproval(2000);

		queue.expireStale(1000);

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({
			scopeId: TEST_SCOPE_ID,
			id: item.id,
			tool: item.tool,
			defaultResolution: "deny",
		});
	});

	it("emits workflow.approval.timeout on the bus for auto-approve", () => {
		const bus = getEventBus()!;
		const received: unknown[] = [];
		bus.on("workflow.approval.timeout", (payload) => received.push(payload));

		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500, "approve");
		agePendingApproval(2000);

		queue.expireStale();

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual({
			scopeId: TEST_SCOPE_ID,
			id: item.id,
			tool: item.tool,
			defaultResolution: "approve",
		});
	});

	it("auto-approve path sets status to approved", () => {
		const bus = getEventBus()!;
		bus.on("workflow.approval.timeout", () => {});

		const item = queue.enqueue("shell", { command: "rm" }, "dangerous", "reason", undefined, 500, "approve");
		agePendingApproval(2000);

		queue.expireStale();

		expect(queue.get(item.id)!.status).toBe("approved");
		expect(queue.get(item.id)!.resolutionSource).toBe("timeout");
	});

	it("isolates scope sweep failures and rejects a non-default scope's expired review receipt", async () => {
		const bus = getEventBus()!;
		const scopeRootA = join(dir, "scope-a");
		const scopeRootB = join(dir, "scope-b");
		mkdirSync(scopeRootA, { recursive: true });
		mkdirSync(scopeRootB, { recursive: true });
		const runtimeA = createTestScopeRuntime(scopeRootA);
		const runtimeB = createTestScopeRuntime(scopeRootB);
		setSchedulerInstance(runtimeA.scheduler);
		setOwnerQuestionQueueInstance(runtimeA.ownerQuestionQueue);
		const executeTool = vi.fn<ToolRunner>();
		registerApprovalExecutionTestTools(executeTool);

		const pending = runtimeB.approvalQueue.enqueue(
			"shell",
			{ command: "deploy" },
			"dangerous",
			"production deployment",
		);
		const review = runtimeB.approvalQueue.projectForClient(pending).review;
		if (review.status !== "available") throw new Error("Expected review descriptor");
		const logs: string[] = [];
		vi.spyOn(runtimeA.approvalQueue, "expireStale").mockImplementation(() => {
			throw new Error("scope-a storage unavailable");
		});
		const unsubscribe = subscribeDaemon({
			bus,
			approvalQueues: () => [
				runtimeA.approvalQueue,
				runtimeB.approvalQueue,
			],
			pollIntervalMs: 10,
			approvalTtlMs: 5,
			onWorkflowCompleted: () => {},
			onRestartRequested: () => {},
			onLog: (message) => logs.push(message),
		});

		try {
			vi.advanceTimersByTime(10);
			expect(logs).toContain(
				`Approval expiration sweep failed for scope ${runtimeA.scope.scopeId}: scope-a storage unavailable`,
			);
			expect(runtimeB.approvalQueue.get(pending.id)).toMatchObject({
				status: "expired",
				rejectionReason: "expired",
			});

			const response = mockResponse();
			await handleApproveApproval(
				mockApprovalRequest(review.digest),
				response.res,
				pending.id,
				null,
				runtimeB.approvalQueue,
			);

			expect(response.result).toMatchObject({
				status: 404,
				body: { error: "Approval not found or not pending" },
			});
			expect(executeTool).not.toHaveBeenCalled();
		} finally {
			unsubscribe();
			await runtimeA.workflowRuntime.stop();
			await runtimeB.workflowRuntime.stop();
			runtimeA.runState.close();
			runtimeB.runState.close();
		}
	});
});

function createTestScopeRuntime(scopeRoot: string): ScopeRuntime {
	return createIsolatedScopeRuntime({
		scope: buildDirectoryScope({ scopeRoot }),
		bus: getEventBus()!,
		config: { approvalTtlMs: 5 },
		onLog: () => {},
		installSingletons: false,
	});
}

function mockApprovalRequest(reviewDigest: string): IncomingMessage {
	const encodedBody = Buffer.from(JSON.stringify({ reviewDigest }));
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
