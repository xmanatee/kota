/**
 * Module infrastructure E2E tests.
 *
 * Exercises the full module pipeline through the agent loop:
 * module loader → tool registration → tool execution → system prompt injection → event bus.
 *
 * Unlike unit tests (which test individual modules in isolation), these prove
 * that the 20+ iterations of module infrastructure actually compose end-to-end
 * through AgentSession.send().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEventBus, initEventBus, resetEventBus } from "./core/events/event-bus.js";
import { AgentSession } from "./core/loop/loop.js";
import { resetWorkingMemory } from "./memory/working-memory.js";
import {
	createMockClient,
	type MockApiCall,
	resetMockIds,
	textResponse,
	toolUseResponse,
} from "./model/mock-client.js";
import { BufferTransport } from "./core/loop/transport.js";

vi.spyOn(console, "error").mockImplementation(() => {});

function createTestSession(
	responses: Parameters<typeof createMockClient>[0],
): { session: AgentSession; transport: BufferTransport; calls: MockApiCall[] } {
	const [client, calls] = createMockClient(responses);
	const transport = new BufferTransport();
	const session = new AgentSession({
		client,
		transport,
		model: "claude-haiku-4-5-20251001",
		noHistory: true,
		reflectionEnabled: false,
		verbose: false,
	});
	return { session, transport, calls };
}

describe("Module E2E: tool registration", () => {
	beforeEach(() => {
		resetMockIds();
	});

	afterEach(() => {
		resetEventBus();
		resetWorkingMemory();
	});

	it("module-provided tools appear in API calls alongside core tools", async () => {
		const { session, calls } = createTestSession([
			textResponse("Hello!"),
		]);

		await session.send("Hi");
		session.close();

		expect(calls).toHaveLength(1);
		const toolNames = calls[0].tools.map((t) => t.name);

		// Core tools present
		expect(toolNames).toContain("shell");
		expect(toolNames).toContain("file_read");
		expect(toolNames).toContain("grep");

		// Module-provided tools present
		expect(toolNames).toContain("working_memory");
	});

	it("module tools are executable through the full loop", async () => {
		const { session, calls } = createTestSession([
			toolUseResponse("working_memory", {
				action: "write",
				key: "plan",
				value: "Step 1: research the topic",
			}),
			textResponse("I've noted the plan in working memory."),
		]);

		const result = await session.send("Start planning");
		session.close();

		expect(calls).toHaveLength(2);

		// Tool result should be in the second API call
		const call2 = calls[1];
		const hasToolResult = call2.messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) =>
						"type" in b &&
						b.type === "tool_result" &&
						"content" in b &&
						typeof b.content === "string" &&
						b.content.includes("updated"),
				),
		);
		expect(hasToolResult).toBe(true);
		expect(result).toContain("noted the plan");
	});
});

describe("Module E2E: working memory → system prompt", () => {
	beforeEach(() => {
		resetMockIds();
		resetWorkingMemory();
	});

	afterEach(() => {
		resetEventBus();
		resetWorkingMemory();
	});

	it("working memory entries appear in system prompt on subsequent turns", async () => {
		const { session, calls } = createTestSession([
			// Turn 1: agent writes to working memory
			toolUseResponse("working_memory", {
				action: "write",
				key: "research",
				value: "Found 3 relevant papers on context management",
			}),
			textResponse("Noted in working memory."),
			// Turn 2: agent just responds (we check the system prompt)
			textResponse("Based on my working memory, I found 3 papers."),
		]);

		// Turn 1: write to working memory
		await session.send("Research context management papers");
		// Turn 2: verify system prompt includes working memory
		await session.send("What did you find?");
		session.close();

		expect(calls).toHaveLength(3);

		// Turn 1's first API call should NOT have actual working memory entries
		// (the module prompt section mentions <working-memory> as documentation,
		// but actual entries use the format "- **key**: value")
		const turn1SystemText = JSON.stringify(calls[0].system);
		expect(turn1SystemText).not.toContain("**research**");

		// Turn 2 call (calls[2]) SHOULD have the working memory entry
		const turn2SystemText = JSON.stringify(calls[2].system);
		expect(turn2SystemText).toContain("**research**");
		expect(turn2SystemText).toContain("Found 3 relevant papers");
	});

	it("multiple working memory entries accumulate across turns", async () => {
		const { session, calls } = createTestSession([
			// Turn 1: write first entry
			toolUseResponse("working_memory", {
				action: "write",
				key: "goal",
				value: "Build a web scraper",
			}),
			textResponse("Goal noted."),
			// Turn 2: write second entry
			toolUseResponse("working_memory", {
				action: "write",
				key: "progress",
				value: "Fetcher module complete",
			}),
			textResponse("Progress updated."),
			// Turn 3: both entries should be in system prompt
			textResponse("I see both entries in my working memory."),
		]);

		await session.send("Goal: build a web scraper");
		await session.send("Update: fetcher done");
		await session.send("Summarize status");
		session.close();

		// The 5th API call (turn 3) should have both entries
		const turn3System = JSON.stringify(calls[4].system);
		expect(turn3System).toContain("goal");
		expect(turn3System).toContain("Build a web scraper");
		expect(turn3System).toContain("progress");
		expect(turn3System).toContain("Fetcher module complete");
	});
});

describe("Module E2E: event bus integration with modules", () => {
	beforeEach(() => {
		resetMockIds();
		resetWorkingMemory();
	});

	afterEach(() => {
		resetEventBus();
		resetWorkingMemory();
	});

	it("session lifecycle events fire when event bus is initialized", async () => {
		initEventBus();
		const bus = getEventBus()!;
		const events: Array<{ name: string; payload: unknown }> = [];

		bus.on("session.start", (payload) => {
			events.push({ name: "session.start", payload });
		});
		bus.on("session.end", (payload) => {
			events.push({ name: "session.end", payload });
		});

		const { session } = createTestSession([
			toolUseResponse("working_memory", {
				action: "write",
				key: "test",
				value: "event test",
			}),
			textResponse("Done."),
		]);

		await session.send("test");
		session.close();

		// Both lifecycle events should have fired
		expect(events.find((e) => e.name === "session.start")).toBeDefined();
		expect(events.find((e) => e.name === "session.end")).toBeDefined();
	});

	it("wildcard listeners receive all events during a session", async () => {
		initEventBus();
		const bus = getEventBus()!;
		const envelopes: Array<{ type: string }> = [];

		bus.on("*", (envelope) => {
			envelopes.push({ type: (envelope as { type: string }).type });
		});

		const { session } = createTestSession([textResponse("Hi!")]);

		await session.send("Hello");
		session.close();

		// Should have received session lifecycle events via wildcard
		const types = envelopes.map((e) => e.type);
		expect(types).toContain("session.start");
		expect(types).toContain("session.end");
	});
});

describe("Module E2E: multi-module composition", () => {
	beforeEach(() => {
		resetMockIds();
		resetWorkingMemory();
	});

	afterEach(() => {
		resetEventBus();
		resetWorkingMemory();
	});

	it("agent uses module tool + core tool in sequence", async () => {
		const { session, calls } = createTestSession([
			// Step 1: write to working memory (module tool)
			toolUseResponse("working_memory", {
				action: "write",
				key: "task",
				value: "Implement auth system",
			}),
			// Step 2: create a todo (core tool)
			toolUseResponse("todo", {
				action: "add",
				task: "Implement auth system",
			}),
			// Step 3: final response
			textResponse("Tracked in both working memory and todo list."),
		]);

		const result = await session.send("Plan the auth implementation");
		session.close();

		expect(calls).toHaveLength(3);

		// Working memory tool result in call 2
		const call2HasWmResult = calls[1].messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) =>
						"type" in b &&
						b.type === "tool_result" &&
						"content" in b &&
						typeof b.content === "string" &&
						b.content.includes("updated"),
				),
		);
		expect(call2HasWmResult).toBe(true);

		// Todo tool result in call 3
		const call3HasTodoResult = calls[2].messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) =>
						"type" in b &&
						b.type === "tool_result" &&
						"content" in b &&
						typeof b.content === "string" &&
						b.content.includes("Added task"),
				),
		);
		expect(call3HasTodoResult).toBe(true);

		expect(result).toContain("working memory");
	});

	it("working memory + shell compose: memory persists across tool calls", async () => {
		const { session, calls } = createTestSession([
			// Step 1: write to working memory
			toolUseResponse("working_memory", {
				action: "write",
				key: "cmd_output",
				value: "placeholder",
			}),
			// Step 2: run a shell command
			toolUseResponse("shell", { command: "echo 'build successful'" }),
			// Step 3: update working memory with result
			toolUseResponse("working_memory", {
				action: "write",
				key: "cmd_output",
				value: "build successful",
			}),
			textResponse("Build succeeded, noted in working memory."),
		]);

		const result = await session.send("Run build and track result");
		session.close();

		expect(calls).toHaveLength(4);

		// The 3rd API call's system prompt should have working memory with "placeholder"
		const call3System = JSON.stringify(calls[2].system);
		expect(call3System).toContain("<working-memory>");
		expect(call3System).toContain("cmd_output");

		// The 4th API call's system prompt should have the updated value
		const call4System = JSON.stringify(calls[3].system);
		expect(call4System).toContain("build successful");

		expect(result).toContain("Build succeeded");
	});
});

describe("Module E2E: prompt section injection", () => {
	beforeEach(() => {
		resetMockIds();
		resetWorkingMemory();
	});

	afterEach(() => {
		resetEventBus();
		resetWorkingMemory();
	});

	it("module prompt sections are included in the system prompt", async () => {
		const { session, calls } = createTestSession([
			textResponse("Ready to help!"),
		]);

		await session.send("Hello");
		session.close();

		// The system prompt should include module prompt sections
		const systemText = JSON.stringify(calls[0].system);

		// Working memory module adds a prompt section about the scratchpad
		expect(systemText).toContain("working memory");
	});
});
