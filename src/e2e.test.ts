/**
 * End-to-end tests for the core agent loop using a mock Anthropic client.
 *
 * These tests exercise the full AgentSession.send() path — streaming,
 * tool execution, context management, event bus, and failure handling —
 * without a real API key.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSkipConfirmations } from "./confirm.js";
import { getEventBus, initEventBus, resetEventBus } from "./core/events/event-bus.js";
import { AgentSession } from "./core/loop/loop.js";
import { BufferTransport } from "./core/loop/transport.js";
import {
	createMockClient,
	type MockApiCall,
	multiToolResponse,
	resetMockIds,
	textResponse,
	toolUseResponse,
} from "./core/model/mock-client.js";

// Suppress console output during tests
vi.spyOn(console, "error").mockImplementation(() => {});

/** Create a minimal session config with mock client and buffer transport. */
function createTestSession(
	responses: Parameters<typeof createMockClient>[0],
	opts?: {
		verbose?: boolean;
		reflectionEnabled?: boolean;
	},
): { session: AgentSession; transport: BufferTransport; calls: MockApiCall[] } {
	const [client, calls] = createMockClient(responses);
	const transport = new BufferTransport();
	const session = new AgentSession({
		client,
		transport,
		model: "claude-haiku-4-5-20251001",
		noHistory: true,
		reflectionEnabled: opts?.reflectionEnabled ?? false,
		verbose: opts?.verbose ?? false,
	});
	return { session, transport, calls };
}

describe("E2E: core agent loop", () => {
	beforeEach(() => {
		resetMockIds();
		setSkipConfirmations(true);
	});

	afterEach(() => {
		setSkipConfirmations(false);
		resetEventBus();
	});

	it("single-turn text response flows through the full loop", async () => {
		const { session, transport } = createTestSession([
			textResponse("Hello! How can I help you?"),
		]);

		const result = await session.send("Say hello");
		session.close();

		expect(result).toBe("Hello! How can I help you?");

		// Transport should have received text events
		const textEvents = transport.events.filter((e) => e.type === "text");
		expect(textEvents.length).toBeGreaterThan(0);
		const textContent = textEvents.map((e) => "content" in e ? e.content : "").join("");
		expect(textContent).toContain("Hello! How can I help you?");
	});

	it("tool call → tool result → final text (multi-turn)", async () => {
		const testDir = join(tmpdir(), `kota-e2e-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		const testFile = join(testDir, "test.txt");
		writeFileSync(testFile, "Hello from test file", "utf-8");

		const { session, calls } = createTestSession([
			// Turn 1: agent calls file_read
			toolUseResponse("file_read", { path: testFile }),
			// Turn 2: agent responds with text after seeing file contents
			textResponse(`The file contains: "Hello from test file"`),
		]);

		const result = await session.send(`Read the file ${testFile}`);
		session.close();

		// Should have made 2 API calls
		expect(calls).toHaveLength(2);

		// First call should be the initial user prompt
		const firstCall = calls[0];
		const userMsg = firstCall.messages.find(
			(m) => m.role === "user" && typeof m.content === "string",
		);
		expect(userMsg).toBeDefined();

		// Second call should include the tool result
		const secondCall = calls[1];
		const toolResultMsg = secondCall.messages.find((m) => {
			if (m.role !== "user" || typeof m.content === "string") return false;
			return Array.isArray(m.content) && m.content.some(
				(b) => "type" in b && b.type === "tool_result",
			);
		});
		expect(toolResultMsg).toBeDefined();

		// Final result should contain the agent's summary
		expect(result).toContain("Hello from test file");

		// Cleanup
		rmSync(testDir, { recursive: true, force: true });
	});

	it("multiple tool calls execute in parallel", async () => {
		const testDir = join(tmpdir(), `kota-e2e-multi-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		writeFileSync(join(testDir, "a.txt"), "file-a", "utf-8");
		writeFileSync(join(testDir, "b.txt"), "file-b", "utf-8");

		const { session, calls } = createTestSession([
			// Turn 1: agent calls two tools at once
			multiToolResponse([
				{ name: "file_read", input: { path: join(testDir, "a.txt") } },
				{ name: "file_read", input: { path: join(testDir, "b.txt") } },
			]),
			// Turn 2: agent responds after seeing both results
			textResponse("Both files read successfully."),
		]);

		const result = await session.send("Read both files");
		session.close();

		expect(calls).toHaveLength(2);
		expect(result).toBe("Both files read successfully.");

		// Second API call should have tool results for both reads
		const secondMsg = calls[1].messages;
		const toolResults = secondMsg.filter((m) => {
			if (m.role !== "user" || typeof m.content === "string") return false;
			return Array.isArray(m.content) && m.content.some(
				(b) => "type" in b && b.type === "tool_result",
			);
		});
		expect(toolResults).toHaveLength(1); // Both results in one message
		const resultContent = toolResults[0].content as Array<{ type: string }>;
		expect(resultContent.filter((b) => b.type === "tool_result")).toHaveLength(2);

		rmSync(testDir, { recursive: true, force: true });
	});

	it("file_write tool creates files through the loop", async () => {
		const testDir = join(tmpdir(), `kota-e2e-write-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		const outFile = join(testDir, "output.txt");

		const { session } = createTestSession([
			toolUseResponse("file_write", {
				path: outFile,
				content: "Generated content",
			}),
			textResponse("File created successfully."),
		]);

		await session.send("Create a file");
		session.close();

		expect(existsSync(outFile)).toBe(true);
		expect(readFileSync(outFile, "utf-8")).toBe("Generated content");

		rmSync(testDir, { recursive: true, force: true });
	});

	it("shell tool executes commands through the loop", async () => {
		const { session, calls } = createTestSession([
			toolUseResponse("shell", { command: "echo 'hello from shell'" }),
			textResponse("The command output was: hello from shell"),
		]);

		const result = await session.send("Run echo");
		session.close();

		expect(calls).toHaveLength(2);
		expect(result).toContain("hello from shell");
	});

	it("circuit breaker triggers after 3 identical failures", async () => {
		// Create a response that calls a tool that will always fail (unknown tool)
		const failResponse = toolUseResponse("nonexistent_tool", {});

		const { session, transport } = createTestSession([
			failResponse,
			failResponse,
			failResponse,
			// After circuit break, the model should get a message about it and respond
			textResponse("I encountered repeated failures."),
		]);

		await session.send("Do something impossible");
		session.close();

		// Should have error events from circuit breaker
		const errorEvents = transport.events.filter((e) => e.type === "error");
		const circuitBreakEvent = errorEvents.find(
			(e) => "message" in e && typeof e.message === "string" && e.message.includes("Circuit breaker"),
		);
		expect(circuitBreakEvent).toBeDefined();
	});

	it("todo tool maintains task state across turns", async () => {
		const { session, calls } = createTestSession([
			// Turn 1: agent creates a todo
			toolUseResponse("todo", {
				action: "add",
				text: "Implement feature X",
			}),
			// Turn 2: agent lists todos
			toolUseResponse("todo", { action: "list" }),
			// Turn 3: agent responds
			textResponse("Task added and verified."),
		]);

		const result = await session.send("Create a task for feature X");
		session.close();

		expect(calls).toHaveLength(3);
		expect(result).toBe("Task added and verified.");
	});

	it("grep tool searches files through the loop", async () => {
		const testDir = join(tmpdir(), `kota-e2e-grep-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		writeFileSync(
			join(testDir, "code.ts"),
			"function hello() {\n  return 'world';\n}\n",
			"utf-8",
		);

		const { session } = createTestSession([
			toolUseResponse("grep", {
				pattern: "hello",
				path: testDir,
			}),
			textResponse("Found the function."),
		]);

		const result = await session.send("Search for hello");
		session.close();

		expect(result).toBe("Found the function.");

		rmSync(testDir, { recursive: true, force: true });
	});

	it("cost tracking accumulates across turns", async () => {
		const { session, transport } = createTestSession([
			toolUseResponse("todo", { action: "add", text: "task 1" }),
			textResponse("Done."),
		]);

		await session.send("Add a task");

		// Should have cost events
		const costEvents = transport.events.filter((e) => e.type === "cost");
		expect(costEvents.length).toBeGreaterThanOrEqual(2); // One per turn

		// Cost summary should be non-empty
		const summary = session.getCostSummary();
		expect(summary).toBeTruthy();
		expect(summary).toContain("$");

		session.close();
	});
});

describe("E2E: event bus integration", () => {
	beforeEach(() => {
		resetMockIds();
		resetEventBus();
	});

	afterEach(() => {
		resetEventBus();
	});

	it("session.start and session.end events fire", async () => {
		initEventBus();
		const bus = getEventBus()!;
		const events: Array<{ name: string; payload: unknown }> = [];

		bus.on("session.start", (payload) => {
			events.push({ name: "session.start", payload });
		});
		bus.on("session.end", (payload) => {
			events.push({ name: "session.end", payload });
		});

		const { session } = createTestSession([textResponse("Hello!")]);

		await session.send("Hi");
		session.close();

		const startEvent = events.find((e) => e.name === "session.start");
		expect(startEvent).toBeDefined();
		expect((startEvent!.payload as { sessionId: string }).sessionId).toBeTruthy();

		const endEvent = events.find((e) => e.name === "session.end");
		expect(endEvent).toBeDefined();
		const endPayload = endEvent!.payload as { durationMs: number; error?: string };
		expect(endPayload.durationMs).toBeGreaterThanOrEqual(0);
		expect(endPayload.error).toBeUndefined();
	});

	it("session.end reports error status when session errored", async () => {
		initEventBus();
		const bus = getEventBus()!;
		let endPayload: { error?: string } | null = null;

		bus.on("session.end", (payload) => {
			endPayload = payload as { error?: string };
		});

		const { session } = createTestSession([textResponse("Fine")]);

		await session.send("test");
		session.close(true); // errored = true

		expect(endPayload).toBeDefined();
		expect(endPayload!.error).toBeTruthy();
	});
});

describe("E2E: multi-send session persistence", () => {
	beforeEach(() => {
		resetMockIds();
	});

	afterEach(() => {
		resetEventBus();
	});

	it("context accumulates across multiple send() calls", async () => {
		const { session, calls } = createTestSession([
			textResponse("I understand, you like TypeScript."),
			textResponse("Yes, you told me you like TypeScript."),
		]);

		await session.send("I like TypeScript");
		await session.send("Do you remember what I said?");
		session.close();

		expect(calls).toHaveLength(2);

		// Second call should include messages from the first exchange
		const secondCallMessages = calls[1].messages;
		expect(secondCallMessages.length).toBeGreaterThan(2); // user + assistant + user at minimum

		// Should contain both user messages
		const userMessages = secondCallMessages.filter(
			(m) => m.role === "user" && typeof m.content === "string",
		);
		expect(userMessages.length).toBeGreaterThanOrEqual(2);
	});
});

describe("E2E: observation masking", () => {
	beforeEach(() => {
		resetMockIds();
	});

	afterEach(() => {
		resetEventBus();
	});

	it("old tool results get masked as context grows", async () => {
		// Masking only kicks in for tool results > 200 chars and outside
		// the rolling window (10 messages). We use shell commands that
		// produce large output to trigger masking.
		const testDir = join(tmpdir(), `kota-e2e-mask-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		// Create a file with >200 chars of content
		const bigContent = "x".repeat(300);
		writeFileSync(join(testDir, "big.txt"), bigContent, "utf-8");

		const responses = [];
		// 12 file reads to push past the 10-message masking window.
		// Each read returns >200 chars, triggering masking for older results.
		for (let i = 0; i < 12; i++) {
			responses.push(
				toolUseResponse("file_read", { path: join(testDir, "big.txt") }),
			);
		}
		responses.push(textResponse("Done reading."));

		const { session, transport } = createTestSession(responses, {
			verbose: true,
		});

		const result = await session.send("Read the file many times");
		session.close();

		expect(result).toBe("Done reading.");

		// Should have masking status messages once context grows past window
		const maskEvents = transport.events.filter(
			(e) =>
				e.type === "status" &&
				"message" in e &&
				typeof e.message === "string" &&
				e.message.includes("Masked"),
		);
		expect(maskEvents.length).toBeGreaterThan(0);

		rmSync(testDir, { recursive: true, force: true });
	});
});

describe("E2E: mock client behavior", () => {
	beforeEach(() => {
		resetMockIds();
	});

	it("reuses last response when sequence is exhausted", async () => {
		const { session, calls } = createTestSession([
			toolUseResponse("todo", { action: "add", text: "x" }),
			toolUseResponse("todo", { action: "add", text: "y" }),
			// Only 2 tool responses + no explicit text response.
			// The last response (todo add) will be reused, but eventually
			// the circuit breaker won't fire because errors are different.
			// In practice, tests should always end with a textResponse.
			textResponse("Done."),
		]);

		const result = await session.send("test");
		session.close();

		expect(result).toBe("Done.");
		expect(calls.length).toBeGreaterThanOrEqual(3);
	});

	it("captures API call parameters for assertion", async () => {
		const { session, calls } = createTestSession([
			textResponse("Hi!"),
		]);

		await session.send("Hello, world!");
		session.close();

		expect(calls).toHaveLength(1);
		expect(calls[0].model).toBe("claude-haiku-4-5-20251001");
		expect(calls[0].tools.length).toBeGreaterThan(0);
		expect(calls[0].system).toBeDefined();

		// Should have tools in the request
		const toolNames = calls[0].tools.map((t) => t.name);
		expect(toolNames).toContain("shell");
		expect(toolNames).toContain("file_read");
		expect(toolNames).toContain("grep");
	});
});

describe("E2E: session state machine", () => {
	beforeEach(() => {
		resetMockIds();
	});

	afterEach(() => {
		resetEventBus();
	});

	it("emits state_change transport events through a single-turn text response", async () => {
		const { session, transport } = createTestSession([
			textResponse("Hello!"),
		]);

		await session.send("Hi");
		expect(session.getState()).toBe("ready");

		session.close();
		expect(session.getState()).toBe("closed");

		const stateEvents = transport.events
			.filter((e) => e.type === "state_change")
			.map((e) => {
				const se = e as { from: string; to: string };
				return `${se.from}→${se.to}`;
			});

		// Should include: idle→initializing, initializing→ready, ready→thinking, thinking→ready, ready→closed
		expect(stateEvents).toContain("idle→initializing");
		expect(stateEvents).toContain("initializing→ready");
		expect(stateEvents).toContain("ready→thinking");
		expect(stateEvents).toContain("thinking→ready");
		expect(stateEvents).toContain("ready→closed");
	});

	it("includes acting state during tool call cycles", async () => {
		const testDir = join(tmpdir(), `kota-e2e-state-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		const testFile = join(testDir, "hello.txt");
		writeFileSync(testFile, "world", "utf-8");

		const { session, transport } = createTestSession([
			toolUseResponse("file_read", { path: testFile }),
			textResponse("The file says world."),
		]);

		await session.send("Read the file");
		session.close();

		const stateEvents = transport.events
			.filter((e) => e.type === "state_change")
			.map((e) => {
				const se = e as { from: string; to: string };
				return `${se.from}→${se.to}`;
			});

		// Should include thinking→acting (tool execution) and acting→thinking (back to LLM)
		expect(stateEvents).toContain("thinking→acting");
		expect(stateEvents).toContain("acting→thinking");

		rmSync(testDir, { recursive: true, force: true });
	});

	it("emits session.state events on the event bus", async () => {
		initEventBus();
		const bus = getEventBus()!;
		const stateEvents: Array<{ from: string; to: string }> = [];

		bus.on("session.state", (payload) => {
			stateEvents.push({ from: payload.from, to: payload.to });
		});

		const { session } = createTestSession([textResponse("OK")]);
		await session.send("test");
		session.close();

		// Should have captured state transitions via the bus
		expect(stateEvents.length).toBeGreaterThanOrEqual(4);
		expect(stateEvents[0]).toEqual({ from: "idle", to: "initializing" });
		expect(stateEvents[1]).toEqual({ from: "initializing", to: "ready" });
		expect(stateEvents.some((e) => e.to === "thinking")).toBe(true);
		expect(stateEvents.some((e) => e.to === "closed")).toBe(true);
	});

	it("getState() reflects current state during session lifecycle", async () => {
		const { session } = createTestSession([textResponse("Done")]);

		// After construction + init, state should be ready
		// (initPromise resolves during send)
		expect(session.getState()).toBe("initializing");

		await session.send("test");
		expect(session.getState()).toBe("ready");

		session.close();
		expect(session.getState()).toBe("closed");
	});
});
