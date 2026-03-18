import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EventBus, initEventBus, resetEventBus } from "../event-bus.js";
import { runConfirm, setConfirmOverride } from "./confirm.js";

describe("confirm tool", () => {
	let bus: EventBus;

	beforeEach(() => {
		bus = initEventBus();
	});

	afterEach(() => {
		setConfirmOverride(null);
		resetEventBus();
	});

	it("returns APPROVED when override approves", async () => {
		setConfirmOverride(async () => ({ approved: true }));
		const result = await runConfirm({ action: "Delete old logs" });
		expect(result.content).toBe("APPROVED: Delete old logs");
		expect(result.is_error).toBeUndefined();
	});

	it("returns REJECTED when override rejects", async () => {
		setConfirmOverride(async () => ({ approved: false, reason: "Too risky" }));
		const result = await runConfirm({ action: "Drop database" });
		expect(result.content).toBe("REJECTED: Drop database\nReason: Too risky");
	});

	it("returns REJECTED with no reason when override rejects silently", async () => {
		setConfirmOverride(async () => ({ approved: false }));
		const result = await runConfirm({ action: "Send email" });
		expect(result.content).toBe("REJECTED: Send email");
	});

	it("requires action parameter", async () => {
		const result = await runConfirm({});
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("action is required");
	});

	it("requires non-empty action", async () => {
		const result = await runConfirm({ action: "   " });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("action is required");
	});

	it("validates risk parameter", async () => {
		const result = await runConfirm({ action: "Test", risk: "extreme" });
		expect(result.is_error).toBe(true);
		expect(result.content).toContain("risk must be low, medium, or high");
	});

	it("defaults risk to medium", async () => {
		let capturedInput: { risk?: string } | undefined;
		setConfirmOverride(async (input) => {
			capturedInput = input;
			return { approved: true };
		});
		await runConfirm({ action: "Test" });
		expect(capturedInput?.risk).toBe("medium");
	});

	it("passes details to override", async () => {
		let capturedInput: { details?: string } | undefined;
		setConfirmOverride(async (input) => {
			capturedInput = input;
			return { approved: true };
		});
		await runConfirm({ action: "Deploy", details: "Affects production" });
		expect(capturedInput?.details).toBe("Affects production");
	});

	it("uses risk-based timeout when not specified", async () => {
		const timeouts: number[] = [];
		setConfirmOverride(async (input) => {
			timeouts.push(input.timeout ?? 0);
			return { approved: true };
		});

		await runConfirm({ action: "A", risk: "low" });
		await runConfirm({ action: "B", risk: "medium" });
		await runConfirm({ action: "C", risk: "high" });

		expect(timeouts).toEqual([60, 300, 600]);
	});

	it("uses explicit timeout over risk-based default", async () => {
		let capturedTimeout: number | undefined;
		setConfirmOverride(async (input) => {
			capturedTimeout = input.timeout;
			return { approved: true };
		});
		await runConfirm({ action: "Test", risk: "high", timeout: 30 });
		expect(capturedTimeout).toBe(30);
	});

	it("emits confirm.requested event", async () => {
		const events: Record<string, unknown>[] = [];
		bus.on("confirm.requested", (payload) => events.push(payload));

		setConfirmOverride(async () => ({ approved: true }));
		await runConfirm({ action: "Delete files", risk: "high", details: "47 files" });

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			action: "Delete files",
			risk: "high",
			details: "47 files",
			timeout: 600,
		});
	});

	it("emits confirm.resolved event on approval", async () => {
		const events: Record<string, unknown>[] = [];
		bus.on("confirm.resolved", (payload) => events.push(payload));

		setConfirmOverride(async () => ({ approved: true }));
		await runConfirm({ action: "Deploy" });

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			action: "Deploy",
			risk: "medium",
			approved: true,
			reason: "",
		});
	});

	it("emits confirm.resolved event on rejection with reason", async () => {
		const events: Record<string, unknown>[] = [];
		bus.on("confirm.resolved", (payload) => events.push(payload));

		setConfirmOverride(async () => ({ approved: false, reason: "Not now" }));
		await runConfirm({ action: "Send email" });

		expect(events[0]).toMatchObject({
			approved: false,
			reason: "Not now",
		});
	});

	it("auto-rejects when no terminal available (override throws)", async () => {
		setConfirmOverride(async () => {
			throw new Error("No terminal");
		});
		const result = await runConfirm({ action: "Test" });
		expect(result.content).toContain("REJECTED");
		expect(result.content).toContain("auto-rejected");
	});

	it("emits resolved event even on auto-reject", async () => {
		const events: Record<string, unknown>[] = [];
		bus.on("confirm.resolved", (payload) => events.push(payload));

		setConfirmOverride(async () => {
			throw new Error("No terminal");
		});
		await runConfirm({ action: "Test" });

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ approved: false });
	});

	it("works without event bus initialized", async () => {
		resetEventBus();
		setConfirmOverride(async () => ({ approved: true }));
		const result = await runConfirm({ action: "Test" });
		expect(result.content).toBe("APPROVED: Test");
	});

	it("accepts all valid risk levels", async () => {
		setConfirmOverride(async () => ({ approved: true }));
		for (const risk of ["low", "medium", "high"]) {
			const result = await runConfirm({ action: "Test", risk });
			expect(result.is_error).toBeUndefined();
		}
	});

	it("handles empty details gracefully", async () => {
		const events: Record<string, unknown>[] = [];
		bus.on("confirm.requested", (payload) => events.push(payload));

		setConfirmOverride(async () => ({ approved: true }));
		await runConfirm({ action: "Test" });

		expect(events[0]).toMatchObject({ details: "" });
	});
});
