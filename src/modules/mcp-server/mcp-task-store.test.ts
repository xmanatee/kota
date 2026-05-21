import { describe, expect, it } from "vitest";
import type { McpInputRequiredResult } from "./mcp-protocol-types.js";
import { McpTaskStore } from "./mcp-task-store.js";

function manualClock(start = Date.parse("2026-05-21T00:00:00.000Z")) {
	let now = start;
	return {
		now: () => new Date(now),
		advance: (ms: number) => {
			now += ms;
		},
		iso: () => new Date(now).toISOString(),
	};
}

function idGenerator(ids: string[]): () => string {
	let index = 0;
	return () => ids[index++] ?? `task-generated-${index}`;
}

function inputRequiredResult(): McpInputRequiredResult {
	return {
		resultType: "input_required",
		inputRequests: {
			confirm: {
				method: "elicitation/create",
				params: {
					mode: "form",
					message: "Approve?",
					requestedSchema: {
						type: "object",
						properties: {
							confirmed: { type: "boolean", title: "Approve?" },
						},
					},
				},
			},
		},
		requestState: "state-token",
	};
}

describe("McpTaskStore", () => {
	it("creates tasks with receiver-owned ids, ISO timestamps, TTL, and poll interval policy", () => {
		const clock = manualClock();
		const store = new McpTaskStore({
			now: clock.now,
			generateTaskId: idGenerator(["task-a", "task-b"]),
			defaultTtlMs: 60_000,
			pollIntervalMs: 2_000,
		});

		const first = store.create({ statusMessage: "Running" });
		const second = store.create({ requestedTtlMs: 120_000, pollIntervalMs: 5_000 });

		expect(first.task).toEqual({
			taskId: "task-a",
			status: "working",
			statusMessage: "Running",
			createdAt: clock.iso(),
			lastUpdatedAt: clock.iso(),
			ttl: 60_000,
			pollInterval: 2_000,
		});
		expect(second.task.taskId).toBe("task-b");
		expect(second.task.ttl).toBe(120_000);
		expect(second.task.pollInterval).toBe(5_000);
		expect(store.read("task-a")).toEqual(first.task);
	});

	it("rejects invalid lifecycle transitions and can resume from input_required to working", async () => {
		const clock = manualClock();
		const store = new McpTaskStore({
			now: clock.now,
			generateTaskId: idGenerator(["task-a"]),
			defaultTtlMs: 60_000,
		});
		store.create();
		const waiter = store.waitForResult("task-a");

		expect(() => store.transition("task-a", { status: "working" })).toThrow(
			"Invalid MCP task transition: working -> working",
		);

		clock.advance(1_000);
		const needsInput = store.transition("task-a", {
			status: "input_required",
			inputRequired: inputRequiredResult(),
			statusMessage: "Waiting for input",
		});

		expect(needsInput.status).toBe("input_required");
		await expect(waiter).resolves.toMatchObject({
			kind: "input_required",
			task: { taskId: "task-a", status: "input_required" },
			inputRequired: { resultType: "input_required", requestState: "state-token" },
		});

		clock.advance(1_000);
		const resumed = store.transition("task-a", { status: "working", statusMessage: "Resumed" });

		expect(resumed.status).toBe("working");
		expect(resumed.statusMessage).toBe("Resumed");
	});

	it("stores terminal success and error settlements and rejects terminal mutation", async () => {
		const clock = manualClock();
		const store = new McpTaskStore({
			now: clock.now,
			generateTaskId: idGenerator(["task-ok", "task-fail", "task-failed-result"]),
			defaultTtlMs: 60_000,
		});
		store.create();
		store.create();
		store.create();

		store.complete("task-ok", { content: [{ type: "text", text: "done" }] });
		await expect(store.waitForResult("task-ok")).resolves.toMatchObject({
			kind: "terminal",
			task: { status: "completed" },
			terminal: { kind: "result", result: { content: [{ type: "text", text: "done" }] } },
		});
		expect(() =>
			store.transition("task-ok", {
				status: "input_required",
				inputRequired: inputRequiredResult(),
			}),
		).toThrow('Cannot transition MCP task "task-ok" from terminal state "completed"');

		store.fail("task-fail", { code: -32603, message: "Tool failed", data: { retryable: false } });
		await expect(store.waitForResult("task-fail")).resolves.toMatchObject({
			kind: "terminal",
			task: { status: "failed" },
			terminal: {
				kind: "error",
				error: { code: -32603, message: "Tool failed", data: { retryable: false } },
			},
		});
		expect(() => store.complete("task-fail", null)).toThrow(
			'Cannot transition MCP task "task-fail" from terminal state "failed"',
		);

		store.failWithResult("task-failed-result", {
			resultType: "complete",
			content: [{ type: "text", text: "tool-level failure" }],
			isError: true,
		});
		await expect(store.waitForResult("task-failed-result")).resolves.toMatchObject({
			kind: "terminal",
			task: { status: "failed" },
			terminal: {
				kind: "result",
				result: {
					resultType: "complete",
					content: [{ type: "text", text: "tool-level failure" }],
					isError: true,
				},
			},
		});
	});

	it("settles cancellation waiters and blocks late completion", async () => {
		const store = new McpTaskStore({
			now: manualClock().now,
			generateTaskId: idGenerator(["task-a"]),
			defaultTtlMs: 60_000,
		});
		store.create();
		const waiter = store.waitForResult("task-a");

		const cancelled = store.cancel("task-a", { statusMessage: "User cancelled" });

		expect(cancelled.status).toBe("cancelled");
		await expect(waiter).resolves.toMatchObject({
			kind: "terminal",
			task: { taskId: "task-a", status: "cancelled" },
			terminal: { kind: "error", error: { code: -32800, message: "User cancelled" } },
		});
		expect(() => store.complete("task-a", { late: true })).toThrow(
			'Cannot transition MCP task "task-a" from terminal state "cancelled"',
		);
		expect(store.read("task-a").status).toBe("cancelled");
	});

	it("expires tasks deterministically and rejects outstanding waiters", async () => {
		const clock = manualClock();
		const store = new McpTaskStore({
			now: clock.now,
			generateTaskId: idGenerator(["task-a"]),
			defaultTtlMs: 50,
		});
		store.create();
		const waiter = store.waitForResult("task-a");

		clock.advance(49);
		expect(store.expire()).toEqual([]);
		clock.advance(1);
		expect(store.expire()).toEqual(["task-a"]);
		await expect(waiter).rejects.toThrow('MCP task "task-a" expired');
		expect(() => store.read("task-a")).toThrow('MCP task "task-a" not found');
	});

	it("lists tasks with deterministic cursor pagination", () => {
		const store = new McpTaskStore({
			now: manualClock().now,
			generateTaskId: idGenerator(["task-a", "task-b", "task-c"]),
			defaultTtlMs: 60_000,
			pageSize: 2,
		});
		store.create();
		store.create();
		store.create();

		const first = store.listPage();
		expect(first.tasks.map((task) => task.taskId)).toEqual(["task-a", "task-b"]);
		if (!first.nextCursor) throw new Error("Expected next cursor");

		const second = store.listPage({ cursor: first.nextCursor });
		expect(second.tasks.map((task) => task.taskId)).toEqual(["task-c"]);
		expect(second.nextCursor).toBeUndefined();
		expect(() => store.listPage({ cursor: "not-a-valid-cursor" })).toThrow(
			"Invalid MCP task cursor",
		);
	});
});
