/**
 * Advanced E2E tests for delegate, architect mode, and scheduled actions.
 *
 * These tests exercise multi-layer agent workflows through the full
 * AgentSession.send() path using mock clients. The LLM is mocked
 * but all tool execution is real.
 *
 * Addresses: NOTES.md "it should also be properly tested somehow" —
 * delegate E2E tests, architect mode tests, scheduled action tests.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEventBus } from "./event-bus.js";
import { AgentSession } from "./loop.js";
import {
	createMockClient,
	type MockApiCall,
	resetMockIds,
	textResponse,
	toolUseResponse,
} from "./mock-client.js";
import { ActionExecutor } from "./scheduler/action-executor.js";
import { resetScheduler, Scheduler } from "./scheduler/scheduler.js";
import { BufferTransport } from "./transport.js";

vi.spyOn(console, "error").mockImplementation(() => {});

function createTestSession(
	responses: Parameters<typeof createMockClient>[0],
	opts?: { verbose?: boolean; architectMode?: boolean },
): { session: AgentSession; transport: BufferTransport; calls: MockApiCall[] } {
	const [client, calls] = createMockClient(responses);
	const transport = new BufferTransport();
	const session = new AgentSession({
		client,
		transport,
		model: "claude-haiku-4-5-20251001",
		noHistory: true,
		reflectionEnabled: false,
		verbose: opts?.verbose ?? false,
		architectMode: opts?.architectMode ?? false,
	});
	return { session, transport, calls };
}

function makeTempDir(suffix: string): string {
	const dir = join(tmpdir(), `kota-adv-${suffix}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ── Delegate E2E Tests ──────────────────────────────────────────────

describe("E2E: delegate sub-agent", () => {
	let testDir: string;

	beforeEach(() => {
		resetMockIds();
		testDir = makeTempDir("delegate");
	});

	afterEach(() => {
		resetEventBus();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("main loop invokes delegate(explore) and receives sub-agent results", async () => {
		const filePath = join(testDir, "data.txt");
		writeFileSync(filePath, "API_KEY=secret-123\nDB_HOST=localhost", "utf-8");

		// Response sequence: main → delegate → delegate → main
		const { session, calls, transport } = createTestSession([
			// Main loop call 1: agent decides to delegate an explore task
			toolUseResponse("delegate", {
				task: `Read the file ${filePath} and report its contents`,
				mode: "explore",
			}),
			// Delegate call 1: sub-agent reads the file
			toolUseResponse("file_read", { path: filePath }),
			// Delegate call 2: sub-agent finishes with summary
			textResponse("The file contains API_KEY and DB_HOST settings."),
			// Main loop call 2: main agent summarizes delegate results
			textResponse("The config file has API_KEY=secret-123 and DB_HOST=localhost."),
		]);

		const result = await session.send("What's in the config file?");
		session.close();

		// Main loop made 2 calls, delegate made 2 calls = 4 total
		expect(calls).toHaveLength(4);

		// Main loop's second call should include the delegate tool result
		const mainCall2 = calls[3];
		const hasDelegateResult = mainCall2.messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) => "type" in b && b.type === "tool_result",
				),
		);
		expect(hasDelegateResult).toBe(true);

		// Transport should show delegate status messages
		const statusEvents = transport.events.filter(
			(e) =>
				e.type === "status" &&
				"message" in e &&
				typeof e.message === "string" &&
				e.message.includes("delegate"),
		);
		expect(statusEvents.length).toBeGreaterThan(0);

		expect(result).toContain("API_KEY");
	});

	it("main loop invokes delegate(execute) which modifies files", async () => {
		const filePath = join(testDir, "hello.txt");
		writeFileSync(filePath, "Hello World", "utf-8");

		const { session, calls } = createTestSession([
			// Main loop call 1: agent delegates a file edit
			toolUseResponse("delegate", {
				task: `Edit ${filePath} and change "World" to "Universe"`,
				mode: "execute",
			}),
			// Delegate call 1: sub-agent reads file first
			toolUseResponse("file_read", { path: filePath }),
			// Delegate call 2: sub-agent edits the file
			toolUseResponse("file_edit", {
				path: filePath,
				old_string: "World",
				new_string: "Universe",
			}),
			// Delegate call 3: sub-agent confirms
			textResponse("Changed 'World' to 'Universe' in hello.txt"),
			// Main loop call 2: main agent reports
			textResponse("The file has been updated."),
		]);

		const result = await session.send("Update the greeting file");
		session.close();

		expect(calls).toHaveLength(5);

		// File was actually modified by the delegate's sub-agent
		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain("Universe");
		expect(content).not.toContain("World");

		expect(result).toContain("updated");
	});

	it("delegate with invalid mode returns error to main loop", async () => {
		const { session, calls } = createTestSession([
			// Main loop call 1: agent tries an invalid delegate mode
			toolUseResponse("delegate", {
				task: "do something",
				mode: "invalid_mode",
			}),
			// Main loop call 2: agent handles the error
			textResponse("The delegation failed due to an invalid mode."),
		]);

		const result = await session.send("Do a thing");
		session.close();

		expect(calls).toHaveLength(2);

		// The second call should contain the error tool_result
		const call2 = calls[1];
		const hasError = call2.messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) =>
						"type" in b &&
						b.type === "tool_result" &&
						"is_error" in b &&
						b.is_error === true,
				),
		);
		expect(hasError).toBe(true);

		expect(result).toContain("failed");
	});

	it("delegate with empty task returns error", async () => {
		const { session, calls } = createTestSession([
			toolUseResponse("delegate", { task: "", mode: "explore" }),
			textResponse("Could not delegate — empty task."),
		]);

		await session.send("Delegate nothing");
		session.close();

		expect(calls).toHaveLength(2);

		// Error tool result for empty task
		const call2 = calls[1];
		const hasError = call2.messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) =>
						"type" in b &&
						b.type === "tool_result" &&
						"is_error" in b &&
						b.is_error === true &&
						"content" in b &&
						typeof b.content === "string" &&
						b.content.includes("task is required"),
				),
		);
		expect(hasError).toBe(true);
	});

	it("main loop invokes delegate(research) for deep multi-step research", async () => {
		// Use file_read (local, instant) instead of web_search (network) to avoid hangs
		const researchFile = join(testDir, "api-notes.txt");
		writeFileSync(researchFile, "REST is simpler; GraphQL reduces over-fetching.", "utf-8");

		const { session, calls, transport } = createTestSession([
			// Main loop call 1: agent decides to delegate a research task
			toolUseResponse("delegate", {
				task: `Research API patterns by reading ${researchFile}`,
				mode: "research",
			}),
			// Research delegate call 1: sub-agent reads a file
			toolUseResponse("file_read", { path: researchFile }),
			// Research delegate call 2: sub-agent synthesizes findings
			textResponse(
				"## Executive summary\nREST is simpler; GraphQL reduces over-fetching.",
			),
			// Main loop call 2: main agent presents the research
			textResponse("Here's a comparison of REST vs GraphQL based on my research."),
		]);

		const result = await session.send("Compare REST and GraphQL APIs");
		session.close();

		// Main loop made 2 calls, research delegate made 2 calls = 4 total
		expect(calls).toHaveLength(4);

		// Research delegate should have been given the RESEARCH_PROMPT
		const delegateCall1 = calls[1];
		const delegateSysPrompt = Array.isArray(delegateCall1.system)
			? delegateCall1.system.map((s: { text?: string }) => s.text || "").join("")
			: String(delegateCall1.system);
		expect(delegateSysPrompt).toContain("Decompose");
		expect(delegateSysPrompt).toContain("Evaluate gaps");

		// Delegate result should flow back to main agent
		const mainCall2 = calls[3];
		const hasDelegateResult = mainCall2.messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) => "type" in b && b.type === "tool_result",
				),
		);
		expect(hasDelegateResult).toBe(true);

		// Metadata should indicate research mode
		const toolResultMsg = mainCall2.messages.find(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some((b) => "type" in b && b.type === "tool_result"),
		);
		const toolResult = Array.isArray(toolResultMsg?.content)
			? toolResultMsg.content.find(
					(b) => "type" in b && b.type === "tool_result",
				)
			: null;
		const resultContent =
			toolResult && "content" in toolResult
				? String(toolResult.content)
				: "";
		expect(resultContent).toContain("[research:");

		// Transport should show delegate(research) status messages
		const statusEvents = transport.events.filter(
			(e) =>
				e.type === "status" &&
				"message" in e &&
				typeof e.message === "string" &&
				e.message.includes("delegate(research)"),
		);
		expect(statusEvents.length).toBeGreaterThan(0);

		expect(result).toContain("REST");
	});

	it("delegate(research) has higher turn limit than explore", async () => {
		// Use file_read (local) instead of web_search (network) to avoid hangs.
		// 12 turns exceeds explore's 10-turn limit but stays within research's 25.
		const researchFile = join(testDir, "consensus.txt");
		writeFileSync(researchFile, "Raft, Paxos, PBFT consensus algorithms.", "utf-8");

		const responses = [
			// Main loop: delegate research
			toolUseResponse("delegate", {
				task: `Deep research by reading ${researchFile} repeatedly`,
				mode: "research",
			}),
			// Research sub-agent: 11 file_read turns + 1 text turn = 12 delegate turns
			...Array.from({ length: 11 }, () =>
				toolUseResponse("file_read", { path: researchFile }),
			),
			// Sub-agent finishes after 12 turns
			textResponse("Comprehensive analysis of Raft, Paxos, and PBFT consensus algorithms."),
			// Main loop summarizes
			textResponse("Here's the research on consensus algorithms."),
		];

		const { session, calls } = createTestSession(responses);
		const result = await session.send("Research consensus algorithms deeply");
		session.close();

		// Should have completed: 1 main + 12 delegate + 1 main = 14 calls
		expect(calls).toHaveLength(14);

		// Check metadata shows 12 turns used (not hit turn limit at 10)
		const mainCall2 = calls[13];
		const toolResultMsg = mainCall2.messages.find(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some((b) => "type" in b && b.type === "tool_result"),
		);
		const toolResult = Array.isArray(toolResultMsg?.content)
			? toolResultMsg.content.find(
					(b) => "type" in b && b.type === "tool_result",
				)
			: null;
		const resultContent =
			toolResult && "content" in toolResult
				? String(toolResult.content)
				: "";
		// Should show research: 12/25 turns (not 10/10 turn limit)
		expect(resultContent).toContain("research: 12/25 turns");
		expect(resultContent).not.toContain("hit turn limit");

		expect(result).toContain("consensus");
	});
});

// ── Architect Mode E2E Tests ────────────────────────────────────────

describe("E2E: architect mode", () => {
	let testDir: string;

	beforeEach(() => {
		resetMockIds();
		testDir = makeTempDir("architect");
	});

	afterEach(() => {
		resetEventBus();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("architect plans, editor executes, main loop verifies", async () => {
		const filePath = join(testDir, "app.ts");
		writeFileSync(filePath, 'const greeting = "hello";\nconsole.log(greeting);\n', "utf-8");

		// Response sequence: architect → editor → editor → editor → main
		const { session, calls } = createTestSession(
			[
				// Architect pass: produces a plan (text only, no tools)
				textResponse(
					`Plan:\n1. Read ${filePath}\n2. Edit "hello" to "goodbye"\n3. Verify the change`,
				),
				// Editor call 1: reads the file
				toolUseResponse("file_read", { path: filePath }),
				// Editor call 2: edits the file
				toolUseResponse("file_edit", {
					path: filePath,
					old_string: '"hello"',
					new_string: '"goodbye"',
				}),
				// Editor call 3: done
				textResponse("All steps completed. Changed greeting to goodbye."),
				// Main loop call 1: main agent verifies after architect
				textResponse("Architect/editor completed. The greeting was updated."),
			],
			{ architectMode: true },
		);

		const result = await session.send("Change the greeting to goodbye");
		session.close();

		// Architect (1) + editor (3) + main loop (1) = 5 calls
		expect(calls).toHaveLength(5);

		// File was modified by the editor
		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain('"goodbye"');
		expect(content).not.toContain('"hello"');

		expect(result).toContain("greeting");
	});

	it("architect mode with multi-step editor execution", async () => {
		const dir = join(testDir, "src");
		mkdirSync(dir, { recursive: true });
		const file1 = join(dir, "a.ts");
		const file2 = join(dir, "b.ts");
		writeFileSync(file1, "export const x = 1;\n", "utf-8");
		writeFileSync(file2, "export const y = 2;\n", "utf-8");

		const { session, calls } = createTestSession(
			[
				// Architect pass
				textResponse(`Plan:\n1. Read a.ts\n2. Read b.ts\n3. Edit both to add type annotations`),
				// Editor reads first file
				toolUseResponse("file_read", { path: file1 }),
				// Editor reads second file
				toolUseResponse("file_read", { path: file2 }),
				// Editor edits first
				toolUseResponse("file_edit", {
					path: file1,
					old_string: "export const x = 1;",
					new_string: "export const x: number = 1;",
				}),
				// Editor edits second
				toolUseResponse("file_edit", {
					path: file2,
					old_string: "export const y = 2;",
					new_string: "export const y: number = 2;",
				}),
				// Editor done
				textResponse("Added type annotations to both files."),
				// Main loop
				textResponse("Type annotations added successfully."),
			],
			{ architectMode: true },
		);

		const result = await session.send("Add type annotations");
		session.close();

		expect(calls).toHaveLength(7);
		expect(readFileSync(file1, "utf-8")).toContain("x: number");
		expect(readFileSync(file2, "utf-8")).toContain("y: number");
		expect(result).toContain("annotations");
	});
});

// ── Scheduled Action E2E Tests ──────────────────────────────────────

describe("E2E: scheduled actions", () => {
	beforeEach(() => {
		resetMockIds();
	});

	afterEach(() => {
		resetEventBus();
		resetScheduler();
	});

	it("ActionExecutor runs a scheduled item's prompt through an agent session", async () => {
		const [client] = createMockClient([
			textResponse("The current time is 12:00 PM."),
		]);

		const executor = new ActionExecutor({
			sessionOptions: {
				client,
				model: "claude-haiku-4-5-20251001",
				noHistory: true,
				reflectionEnabled: false,
			},
			timeoutMs: 10_000,
		});

		const item = {
			id: 1,
			description: "Time check",
			triggerAt: new Date().toISOString(),
			action: "What time is it?",
			status: "pending" as const,
			created: new Date().toISOString(),
		};

		const result = await executor.execute(item);

		expect(result.error).toBeUndefined();
		expect(result.result).toContain("12:00 PM");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.item.id).toBe(1);
	});

	it("ActionExecutor handles missing action gracefully", async () => {
		const [client] = createMockClient([textResponse("unused")]);

		const executor = new ActionExecutor({
			sessionOptions: {
				client,
				model: "claude-haiku-4-5-20251001",
				noHistory: true,
			},
		});

		const item = {
			id: 2,
			description: "No action item",
			triggerAt: new Date().toISOString(),
			status: "pending" as const,
			created: new Date().toISOString(),
			// no action field
		};

		const result = await executor.execute(item);

		expect(result.error).toBe("No action defined");
		expect(result.durationMs).toBe(0);
	});

	it("ActionExecutor respects concurrency limit", async () => {
		// Create a client that returns a response after a delay
		const [client] = createMockClient([
			// First action: calls shell (slow)
			toolUseResponse("shell", { command: "sleep 0.5 && echo done" }),
			textResponse("Action 1 done"),
			// Second action
			toolUseResponse("shell", { command: "echo fast" }),
			textResponse("Action 2 done"),
		]);

		const executor = new ActionExecutor({
			sessionOptions: {
				client,
				model: "claude-haiku-4-5-20251001",
				noHistory: true,
				reflectionEnabled: false,
			},
			maxConcurrent: 1,
			timeoutMs: 10_000,
		});

		const makeItem = (id: number, action: string) => ({
			id,
			description: `Action ${id}`,
			triggerAt: new Date().toISOString(),
			action,
			status: "pending" as const,
			created: new Date().toISOString(),
		});

		// Start first action (occupies the single slot)
		const p1 = executor.execute(makeItem(1, "Do slow thing"));
		expect(executor.activeCount).toBe(1);

		// Try second action while first is running
		const r2 = await executor.execute(makeItem(2, "Do fast thing"));
		expect(r2.error).toContain("Max concurrent");

		// Wait for first to complete
		const r1 = await p1;
		expect(r1.error).toBeUndefined();
	});

	it("Scheduler getDue + ActionExecutor pipeline executes due items", async () => {
		const scheduler = new Scheduler(undefined, null); // in-memory

		// Schedule an item that's already due (past time)
		const pastTime = new Date(Date.now() - 1000);
		scheduler.add("Check disk space", pastTime, {
			action: "Report available disk space",
		});

		// Verify the item is due
		const due = scheduler.getDue();
		expect(due).toHaveLength(1);
		expect(due[0].description).toBe("Check disk space");
		expect(due[0].action).toBe("Report available disk space");

		// Execute the due item
		const [client] = createMockClient([
			textResponse("Disk space: 50GB available on /dev/sda1"),
		]);

		const executor = new ActionExecutor({
			sessionOptions: {
				client,
				model: "claude-haiku-4-5-20251001",
				noHistory: true,
				reflectionEnabled: false,
			},
			timeoutMs: 10_000,
		});

		// Mark fired and execute
		scheduler.markFired(due[0].id);
		const result = await executor.execute(due[0]);

		expect(result.error).toBeUndefined();
		expect(result.result).toContain("50GB");

		// After marking fired, no more due items
		expect(scheduler.getDue()).toHaveLength(0);

		// Item status should be 'fired'
		const item = scheduler.get(due[0].id);
		expect(item?.status).toBe("fired");
	});

	it("ActionExecutor with tool-using action completes multi-turn workflow", async () => {
		const [client, calls] = createMockClient([
			// Action session: agent runs a shell command, then summarizes
			toolUseResponse("shell", { command: "echo system-check-ok" }),
			textResponse("System check passed: all services running."),
		]);

		const executor = new ActionExecutor({
			sessionOptions: {
				client,
				model: "claude-haiku-4-5-20251001",
				noHistory: true,
				reflectionEnabled: false,
			},
			timeoutMs: 10_000,
		});

		const item = {
			id: 10,
			description: "System health check",
			triggerAt: new Date().toISOString(),
			action: "Run a system health check",
			status: "pending" as const,
			created: new Date().toISOString(),
		};

		const result = await executor.execute(item);

		expect(result.error).toBeUndefined();
		expect(result.result).toContain("System check passed");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);

		// Action session made 2 API calls (tool use + final text)
		expect(calls).toHaveLength(2);

		// The prompt was wrapped with autonomous action context
		const firstCallMsg = calls[0].messages[0];
		expect(firstCallMsg.role).toBe("user");
		expect(firstCallMsg.content).toContain("Autonomous action");
		expect(firstCallMsg.content).toContain("System health check");
	});
});
