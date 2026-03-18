import { afterEach, describe, expect, it, vi } from "vitest";
import { runBatch } from "./batch.js";

// Mock runDelegate so we don't make API calls
vi.mock("./delegate.js", () => ({
	runDelegate: vi.fn(),
}));

import { runDelegate } from "./delegate.js";

const mockDelegate = vi.mocked(runDelegate);

afterEach(() => {
	mockDelegate.mockReset();
});

describe("runBatch input validation", () => {
	it("rejects missing tasks", async () => {
		const r = await runBatch({});
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("tasks array is required");
	});

	it("rejects empty tasks array", async () => {
		const r = await runBatch({ tasks: [] });
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("tasks array is required");
	});

	it("rejects too many tasks", async () => {
		const tasks = Array.from({ length: 11 }, (_, i) => `task ${i}`);
		const r = await runBatch({ tasks });
		expect(r.is_error).toBe(true);
		expect(r.content).toContain("max 10 tasks");
	});

	it("rejects invalid mode", async () => {
		const r = await runBatch({ tasks: ["hello"], mode: "bad" });
		expect(r.is_error).toBe(true);
		expect(r.content).toContain('mode must be "explore", "execute", or "research"');
	});
});

describe("runBatch execution", () => {
	it("runs tasks in parallel and collects results", async () => {
		mockDelegate.mockImplementation(async (input) => ({
			content: `Result for: ${(input as Record<string, unknown>).task}`,
		}));

		const r = await runBatch({ tasks: ["alpha", "beta", "gamma"] });
		expect(r.is_error).toBeUndefined();
		expect(r.content).toContain("[batch: 3 tasks | 3 ok, 0 failed");
		expect(r.content).toContain("Result for: alpha");
		expect(r.content).toContain("Result for: beta");
		expect(r.content).toContain("Result for: gamma");
		expect(mockDelegate).toHaveBeenCalledTimes(3);
	});

	it("passes mode through to delegate", async () => {
		mockDelegate.mockResolvedValue({ content: "done" });
		await runBatch({ tasks: ["t1"], mode: "execute" });

		expect(mockDelegate).toHaveBeenCalledWith({ task: "t1", mode: "execute" });
	});

	it("defaults mode to explore", async () => {
		mockDelegate.mockResolvedValue({ content: "done" });
		await runBatch({ tasks: ["t1"] });

		expect(mockDelegate).toHaveBeenCalledWith({ task: "t1", mode: "explore" });
	});

	it("handles partial failures gracefully", async () => {
		mockDelegate
			.mockResolvedValueOnce({ content: "success result" })
			.mockResolvedValueOnce({
				content: "something went wrong",
				is_error: true,
			})
			.mockResolvedValueOnce({ content: "also succeeded" });

		const r = await runBatch({
			tasks: ["good1", "bad", "good2"],
		});
		expect(r.is_error).toBeUndefined();
		expect(r.content).toContain("2 ok, 1 failed");
		expect(r.content).toContain("[OK]: good1");
		expect(r.content).toContain("[ERR]: bad");
		expect(r.content).toContain("[OK]: good2");
	});

	it("catches delegate exceptions", async () => {
		mockDelegate.mockRejectedValue(new Error("API timeout"));

		const r = await runBatch({ tasks: ["crash"] });
		expect(r.is_error).toBeUndefined();
		expect(r.content).toContain("0 ok, 1 failed");
		expect(r.content).toContain("Failed: API timeout");
	});

	it("truncates long results per task", async () => {
		const longContent = "x".repeat(40_000);
		mockDelegate.mockResolvedValue({ content: longContent });

		const r = await runBatch({ tasks: ["a", "b"] });
		// With 2 tasks, budget is 15000 per task; total should be well under 40k
		expect(r.content.length).toBeLessThan(35_000);
		expect(r.content).toContain("(truncated)");
	});
});

describe("runBatch concurrency", () => {
	it("respects max_concurrent limit", async () => {
		let concurrent = 0;
		let maxSeen = 0;

		mockDelegate.mockImplementation(async () => {
			concurrent++;
			maxSeen = Math.max(maxSeen, concurrent);
			await new Promise((r) => setTimeout(r, 20));
			concurrent--;
			return { content: "done" };
		});

		await runBatch({
			tasks: ["a", "b", "c", "d", "e"],
			max_concurrent: 2,
		});

		expect(maxSeen).toBeLessThanOrEqual(2);
		expect(mockDelegate).toHaveBeenCalledTimes(5);
	});

	it("clamps max_concurrent to 5", async () => {
		let concurrent = 0;
		let maxSeen = 0;

		mockDelegate.mockImplementation(async () => {
			concurrent++;
			maxSeen = Math.max(maxSeen, concurrent);
			await new Promise((r) => setTimeout(r, 10));
			concurrent--;
			return { content: "done" };
		});

		await runBatch({
			tasks: ["a", "b", "c", "d", "e", "f", "g", "h"],
			max_concurrent: 100,
		});

		expect(maxSeen).toBeLessThanOrEqual(5);
	});

	it("clamps max_concurrent minimum to 1", async () => {
		mockDelegate.mockResolvedValue({ content: "ok" });

		const r = await runBatch({
			tasks: ["a"],
			max_concurrent: -5,
		});
		expect(r.is_error).toBeUndefined();
		expect(r.content).toContain("1 ok");
	});
});

describe("runBatch result format", () => {
	it("includes header with task count, success/fail, and mode", async () => {
		mockDelegate.mockResolvedValue({ content: "done" });

		const r = await runBatch({
			tasks: ["x", "y"],
			mode: "execute",
		});
		expect(r.content).toMatch(
			/\[batch: 2 tasks \| 2 ok, 0 failed \| mode: execute\]/,
		);
	});

	it("preserves task order in results", async () => {
		const delays = [30, 10, 20];
		mockDelegate.mockImplementation(async (input) => {
			const task = (input as Record<string, unknown>).task as string;
			const idx = ["first", "second", "third"].indexOf(task);
			await new Promise((r) => setTimeout(r, delays[idx]));
			return { content: `result-${task}` };
		});

		const r = await runBatch({ tasks: ["first", "second", "third"] });
		const taskOrder = [...r.content.matchAll(/Task (\d+)/g)].map((m) => m[1]);
		expect(taskOrder).toEqual(["1", "2", "3"]);

		// First result should appear before second
		const pos1 = r.content.indexOf("result-first");
		const pos2 = r.content.indexOf("result-second");
		const pos3 = r.content.indexOf("result-third");
		expect(pos1).toBeLessThan(pos2);
		expect(pos2).toBeLessThan(pos3);
	});
});
