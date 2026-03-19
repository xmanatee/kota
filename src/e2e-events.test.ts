/**
 * E2E tests for event-driven pipelines — event → module handler → tool execution.
 *
 * Tests the full chain: EventBus emits → manifest event handler triggers →
 * step pipeline executes tools → observable side effects (files on disk).
 *
 * Addresses: NOTES.md "properly tested" — event-triggered E2E tests,
 * module event handler E2E tests.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EventBus, initEventBus, resetEventBus } from "./event-bus.js";
import { manifestToModule } from "./manifest/index.js";
import { resetScheduler, Scheduler } from "./scheduler/scheduler.js";

vi.spyOn(console, "error").mockImplementation(() => {});

function makeTempDir(suffix: string): string {
	const dir = join(tmpdir(), `kota-evt-${suffix}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

async function waitFor(
	fn: () => boolean,
	timeoutMs = 3000,
): Promise<void> {
	const start = Date.now();
	while (!fn()) {
		if (Date.now() - start > timeoutMs)
			throw new Error("waitFor timed out");
		await new Promise((r) => setTimeout(r, 50));
	}
}

// ── Step-based event handler E2E tests ──────────────────────────────

describe("E2E: event-driven step handlers", () => {
	let testDir: string;
	let bus: EventBus;

	beforeEach(() => {
		testDir = makeTempDir("events");
		bus = initEventBus();
	});

	afterEach(() => {
		resetEventBus();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("step handler writes file when custom event fires", async () => {
		const outFile = join(testDir, "event-output.txt");
		const mod = manifestToModule({
			name: "file-writer",
			eventHandlers: [
				{
					event: "test.write",
					steps: [
						{
							tool: "file_write",
							input: { path: outFile, content: "event fired!" },
						},
					],
				},
			],
		});

		const unsubs = mod.events!(bus);
		bus.emit("test.write" as never, {} as never);

		await waitFor(() => existsSync(outFile));
		expect(readFileSync(outFile, "utf-8")).toBe("event fired!");

		for (const unsub of unsubs) unsub();
	});

	it("step handler chains $prev between steps", async () => {
		const readFile = join(testDir, "source.txt");
		const outFile = join(testDir, "copy.txt");
		writeFileSync(readFile, "original content", "utf-8");

		const mod = manifestToModule({
			name: "chain-mod",
			eventHandlers: [
				{
					event: "test.chain",
					steps: [
						{ tool: "file_read", input: { path: readFile } },
						{
							tool: "file_write",
							input: { path: outFile, content: "$prev" },
						},
					],
				},
			],
		});

		const unsubs = mod.events!(bus);
		bus.emit("test.chain" as never, {} as never);

		await waitFor(() => existsSync(outFile));
		expect(readFileSync(outFile, "utf-8")).toContain("original content");

		for (const unsub of unsubs) unsub();
	});

	it("step handler evaluates conditional step (true path)", async () => {
		const outFile = join(testDir, "conditional.txt");
		const mod = manifestToModule({
			name: "cond-true-mod",
			eventHandlers: [
				{
					event: "test.cond",
					steps: [
						{ tool: "shell", input: { command: "echo ok" } },
						{
							tool: "file_write",
							input: { path: outFile, content: "condition met" },
							if: "$prev contains ok",
						},
					],
				},
			],
		});

		const unsubs = mod.events!(bus);
		bus.emit("test.cond" as never, {} as never);

		await waitFor(() => existsSync(outFile));
		expect(readFileSync(outFile, "utf-8")).toBe("condition met");

		for (const unsub of unsubs) unsub();
	});

	it("step handler skips step when condition is false", async () => {
		const outFile = join(testDir, "should-not-exist.txt");
		const mod = manifestToModule({
			name: "cond-false-mod",
			eventHandlers: [
				{
					event: "test.skip",
					steps: [
						{ tool: "shell", input: { command: "echo fail" } },
						{
							tool: "file_write",
							input: {
								path: outFile,
								content: "should not write",
							},
							if: "$prev contains success",
						},
					],
				},
			],
		});

		const unsubs = mod.events!(bus);
		bus.emit("test.skip" as never, {} as never);

		await new Promise((r) => setTimeout(r, 500));
		expect(existsSync(outFile)).toBe(false);

		for (const unsub of unsubs) unsub();
	});

	it("error in step stops pipeline without crashing bus", async () => {
		const outFile = join(testDir, "after-error.txt");
		const mod = manifestToModule({
			name: "error-mod",
			eventHandlers: [
				{
					event: "test.error",
					steps: [
						{
							tool: "file_read",
							input: {
								path: "/nonexistent/kota-test-path/file.txt",
							},
						},
						{
							tool: "file_write",
							input: {
								path: outFile,
								content: "should not write",
							},
						},
					],
				},
			],
		});

		const unsubs = mod.events!(bus);
		bus.emit("test.error" as never, {} as never);

		await new Promise((r) => setTimeout(r, 500));
		expect(existsSync(outFile)).toBe(false);

		// Bus still works after handler error
		let received = false;
		bus.on("test.verify" as never, (() => {
			received = true;
		}) as never);
		bus.emit("test.verify" as never, {} as never);
		expect(received).toBe(true);

		for (const unsub of unsubs) unsub();
	});
});

// ── Typed event → handler pipeline E2E tests ────────────────────────

describe("E2E: typed event → handler pipeline", () => {
	let testDir: string;
	let bus: EventBus;

	beforeEach(() => {
		testDir = makeTempDir("typed-evt");
		bus = initEventBus();
	});

	afterEach(() => {
		resetEventBus();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("schedule.fire event triggers handler with $payload template", async () => {
		const outFile = join(testDir, "schedule-triggered.txt");
		const mod = manifestToModule({
			name: "schedule-reactor",
			eventHandlers: [
				{
					event: "schedule.fire",
					steps: [
						{
							tool: "file_write",
							input: {
								path: outFile,
								content:
									"Fired: {{$payload.description}}",
							},
						},
					],
				},
			],
		});

		const unsubs = mod.events!(bus);
		bus.emit("schedule.fire", {
			itemId: 42,
			description: "daily-report",
			action: "Generate daily report",
		});

		await waitFor(() => existsSync(outFile));
		expect(readFileSync(outFile, "utf-8")).toContain("daily-report");

		for (const unsub of unsubs) unsub();
	});

	it("knowledge.create event triggers handler with payload fields", async () => {
		const outFile = join(testDir, "knowledge-reaction.txt");
		const mod = manifestToModule({
			name: "knowledge-watcher",
			eventHandlers: [
				{
					event: "knowledge.create",
					steps: [
						{
							tool: "file_write",
							input: {
								path: outFile,
								content:
									"New: {{$payload.title}} ({{$payload.type}})",
							},
						},
					],
				},
			],
		});

		const unsubs = mod.events!(bus);
		bus.emit("knowledge.create", {
			id: "abc123",
			title: "API Best Practices",
			type: "reference",
			tags: ["api"],
			scope: "global",
		});

		await waitFor(() => existsSync(outFile));
		const content = readFileSync(outFile, "utf-8");
		expect(content).toContain("API Best Practices");
		expect(content).toContain("reference");

		for (const unsub of unsubs) unsub();
	});

	it("$payload.field whole-value resolution in step input", async () => {
		const outFile = join(testDir, "payload-field.txt");
		const mod = manifestToModule({
			name: "payload-mod",
			eventHandlers: [
				{
					event: "test.payload",
					steps: [
						{
							tool: "file_write",
							input: {
								path: outFile,
								content: "$payload.message",
							},
						},
					],
				},
			],
		});

		const unsubs = mod.events!(bus);
		bus.emit("test.payload" as never, {
			message: "hello from payload",
		} as never);

		await waitFor(() => existsSync(outFile));
		expect(readFileSync(outFile, "utf-8")).toBe("hello from payload");

		for (const unsub of unsubs) unsub();
	});
});

// ── Multi-handler and lifecycle E2E tests ────────────────────────────

describe("E2E: multi-handler and lifecycle", () => {
	let testDir: string;
	let bus: EventBus;

	beforeEach(() => {
		testDir = makeTempDir("multi");
		bus = initEventBus();
	});

	afterEach(() => {
		resetEventBus();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("multiple handlers on same event all execute", async () => {
		const file1 = join(testDir, "handler1.txt");
		const file2 = join(testDir, "handler2.txt");

		const mod1 = manifestToModule({
			name: "handler-1",
			eventHandlers: [
				{
					event: "test.multi",
					steps: [
						{
							tool: "file_write",
							input: { path: file1, content: "handler 1" },
						},
					],
				},
			],
		});

		const mod2 = manifestToModule({
			name: "handler-2",
			eventHandlers: [
				{
					event: "test.multi",
					steps: [
						{
							tool: "file_write",
							input: { path: file2, content: "handler 2" },
						},
					],
				},
			],
		});

		const unsubs = [
			...mod1.events!(bus),
			...mod2.events!(bus),
		];
		bus.emit("test.multi" as never, {} as never);

		await waitFor(() => existsSync(file1) && existsSync(file2));
		expect(readFileSync(file1, "utf-8")).toBe("handler 1");
		expect(readFileSync(file2, "utf-8")).toBe("handler 2");

		for (const unsub of unsubs) unsub();
	});

	it("unsubscribed handler does not fire", async () => {
		const outFile = join(testDir, "unsub.txt");
		const mod = manifestToModule({
			name: "unsub-mod",
			eventHandlers: [
				{
					event: "test.unsub",
					steps: [
						{
							tool: "file_write",
							input: {
								path: outFile,
								content: "should not appear",
							},
						},
					],
				},
			],
		});

		const unsubs = mod.events!(bus);
		for (const unsub of unsubs) unsub();

		bus.emit("test.unsub" as never, {} as never);

		await new Promise((r) => setTimeout(r, 500));
		expect(existsSync(outFile)).toBe(false);
	});

	it("step handler supports $steps[N] back-references", async () => {
		const inputFile = join(testDir, "input.txt");
		const outFile = join(testDir, "combined.txt");
		writeFileSync(inputFile, "step zero content", "utf-8");

		const mod = manifestToModule({
			name: "steps-ref-mod",
			eventHandlers: [
				{
					event: "test.steps-ref",
					steps: [
						{ tool: "file_read", input: { path: inputFile } },
						{
							tool: "shell",
							input: { command: "echo step-one-output" },
						},
						{
							tool: "file_write",
							input: {
								path: outFile,
								content:
									"Read: {{$steps[0]}} | Shell: {{$steps[1]}}",
							},
						},
					],
				},
			],
		});

		const unsubs = mod.events!(bus);
		bus.emit("test.steps-ref" as never, {} as never);

		await waitFor(() => existsSync(outFile));
		const content = readFileSync(outFile, "utf-8");
		expect(content).toContain("step zero content");
		expect(content).toContain("step-one-output");

		for (const unsub of unsubs) unsub();
	});
});

// ── Full scheduler → event → handler pipeline ───────────────────────

describe("E2E: scheduler → event → handler pipeline", () => {
	let testDir: string;
	let bus: EventBus;

	beforeEach(() => {
		testDir = makeTempDir("pipeline");
		bus = initEventBus();
	});

	afterEach(() => {
		resetEventBus();
		resetScheduler();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("scheduler getDue → markFired → emit → handler → file written", async () => {
		const outFile = join(testDir, "full-pipeline.txt");
		const scheduler = new Scheduler(undefined, null);

		const mod = manifestToModule({
			name: "pipeline-mod",
			eventHandlers: [
				{
					event: "schedule.fire",
					steps: [
						{
							tool: "file_write",
							input: {
								path: outFile,
								content:
									"Executed: {{$payload.description}}",
							},
						},
					],
				},
			],
		});

		const unsubs = mod.events!(bus);

		// Schedule an already-due item
		scheduler.add("health-check", new Date(Date.now() - 1000));

		const due = scheduler.getDue();
		expect(due).toHaveLength(1);

		// Simulate daemon tick: markFired internally emits schedule.fire
		for (const item of due) {
			scheduler.markFired(item.id);
		}

		await waitFor(() => existsSync(outFile));
		expect(readFileSync(outFile, "utf-8")).toContain("health-check");
		expect(scheduler.getDue()).toHaveLength(0);

		for (const unsub of unsubs) unsub();
	});

	it("multiple due items each trigger their own handler execution", async () => {
		const scheduler = new Scheduler(undefined, null);

		// Track fired events via direct bus listener
		const firedIds: number[] = [];
		bus.on("schedule.fire", (p) => firedIds.push(p.itemId));

		// Module reacts to each fire and writes a file
		const mod = manifestToModule({
			name: "multi-schedule-mod",
			eventHandlers: [
				{
					event: "schedule.fire",
					steps: [
						{
							tool: "file_write",
							input: {
								path: join(testDir, "item-{{$payload.itemId}}.txt"),
								content: "fired: {{$payload.description}}",
							},
						},
					],
				},
			],
		});
		const unsubs = mod.events!(bus);

		const past = new Date(Date.now() - 1000);
		scheduler.add("task-a", past);
		scheduler.add("task-b", past);

		const due = scheduler.getDue();
		expect(due).toHaveLength(2);

		// markFired internally emits schedule.fire
		for (const item of due) {
			scheduler.markFired(item.id);
		}

		// Both events received by direct listener
		expect(firedIds).toHaveLength(2);
		expect(scheduler.getDue()).toHaveLength(0);

		// Wait for step handlers to execute and write files
		await waitFor(
			() =>
				existsSync(join(testDir, `item-${firedIds[0]}.txt`)) &&
				existsSync(join(testDir, `item-${firedIds[1]}.txt`)),
		);

		expect(
			readFileSync(join(testDir, `item-${firedIds[0]}.txt`), "utf-8"),
		).toContain("task-a");
		expect(
			readFileSync(join(testDir, `item-${firedIds[1]}.txt`), "utf-8"),
		).toContain("task-b");

		for (const unsub of unsubs) unsub();
	});
});
