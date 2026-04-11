/**
 * Composition E2E tests — verify that individually-tested capabilities
 * compose into working multi-step workflows.
 *
 * Each scenario exercises a realistic user workflow through the full
 * AgentSession.send() path using the mock Anthropic client. The LLM
 * responses are pre-configured, but all tool execution is real — files
 * are created, edited, read, and searched on disk.
 *
 * Why these tests matter: SWE-EVO (arXiv 2512.18470) shows that
 * single-task evaluation overstates capability 3x for compositional
 * work. These tests prove the agent's capabilities work together.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSkipConfirmations } from "#core/util/confirm.js";
import { resetEventBus } from "./core/events/event-bus.js";
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

vi.spyOn(console, "error").mockImplementation(() => {});

// Tests write files to /tmp which is outside the project directory.
// Skip confirmations so the confirm gate doesn't auto-reject those writes.
beforeEach(() => setSkipConfirmations(true));
afterEach(() => setSkipConfirmations(false));

function createTestSession(
	responses: Parameters<typeof createMockClient>[0],
	opts?: { verbose?: boolean },
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
	});
	return { session, transport, calls };
}

function makeTempDir(suffix: string): string {
	const dir = join(tmpdir(), `kota-comp-${suffix}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("Composition: code fix workflow (grep → read → edit → read-back)", () => {
	let testDir: string;

	beforeEach(() => {
		resetMockIds();
		testDir = makeTempDir("codefix");
		writeFileSync(
			join(testDir, "greet.js"),
			'function greet(name) {\n  return "Helo, " + name;\n}\nmodule.exports = greet;\n',
			"utf-8",
		);
	});

	afterEach(() => {
		resetEventBus();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("agent searches, reads, edits, and verifies a file in sequence", async () => {
		const filePath = join(testDir, "greet.js");

		const { session, calls } = createTestSession([
			// Step 1: grep to find the file with the typo
			toolUseResponse("grep", { pattern: "Helo", path: testDir }),
			// Step 2: read the file to see its contents
			toolUseResponse("file_read", { path: filePath }),
			// Step 3: edit the file to fix the typo
			toolUseResponse("file_edit", {
				path: filePath,
				old_string: '"Helo, "',
				new_string: '"Hello, "',
			}),
			// Step 4: read back to verify the fix
			toolUseResponse("file_read", { path: filePath }),
			// Step 5: final text response
			textResponse('Fixed the typo in greet.js: "Helo" → "Hello"'),
		]);

		const result = await session.send("Fix the typo in the greeting function");
		session.close();

		// All 5 turns executed
		expect(calls).toHaveLength(5);

		// File was actually modified on disk
		const final = readFileSync(filePath, "utf-8");
		expect(final).toContain('"Hello, "');
		expect(final).not.toContain('"Helo, "');

		// Each subsequent API call includes tool results from the previous step
		// Call 2 should have grep results from call 1
		const call2Messages = calls[1].messages;
		const hasGrepResult = call2Messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) => "type" in b && b.type === "tool_result",
				),
		);
		expect(hasGrepResult).toBe(true);

		// Call 4 should have edit result from call 3
		const call4Messages = calls[3].messages;
		const hasEditResult = call4Messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) =>
						"type" in b &&
						b.type === "tool_result" &&
						"content" in b &&
						typeof b.content === "string" &&
						b.content.includes("Replaced"),
				),
		);
		expect(hasEditResult).toBe(true);

		expect(result).toContain("Fixed the typo");
	});
});

describe("Composition: error recovery (read fails → grep → read correct)", () => {
	let testDir: string;

	beforeEach(() => {
		resetMockIds();
		testDir = makeTempDir("recovery");
		mkdirSync(join(testDir, "src"), { recursive: true });
		writeFileSync(
			join(testDir, "src", "utils.js"),
			'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n',
			"utf-8",
		);
	});

	afterEach(() => {
		resetEventBus();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("agent recovers from a missing file by searching and reading the correct one", async () => {
		const wrongPath = join(testDir, "src", "helpers.js");
		const correctPath = join(testDir, "src", "utils.js");

		const { session, calls } = createTestSession([
			// Step 1: agent tries to read the wrong file
			toolUseResponse("file_read", { path: wrongPath }),
			// Step 2: agent greps to find the right file
			toolUseResponse("grep", {
				pattern: "function add",
				path: testDir,
			}),
			// Step 3: agent reads the correct file
			toolUseResponse("file_read", { path: correctPath }),
			// Step 4: final response
			textResponse("Found the add function in src/utils.js"),
		]);

		const result = await session.send("Read the helpers file with the add function");
		session.close();

		expect(calls).toHaveLength(4);

		// Call 2 should contain the error from the failed file_read
		const call2Messages = calls[1].messages;
		const hasErrorResult = call2Messages.some(
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
		expect(hasErrorResult).toBe(true);

		// Call 3 should have grep results showing utils.js
		const call3Messages = calls[2].messages;
		const hasGrepResult = call3Messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) =>
						"type" in b &&
						b.type === "tool_result" &&
						"content" in b &&
						typeof b.content === "string" &&
						b.content.includes("utils.js"),
				),
		);
		expect(hasGrepResult).toBe(true);

		expect(result).toContain("src/utils.js");
	});
});

describe("Composition: write → edit → read roundtrip", () => {
	let testDir: string;

	beforeEach(() => {
		resetMockIds();
		testDir = makeTempDir("roundtrip");
	});

	afterEach(() => {
		resetEventBus();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("agent creates a file, edits it, and reads back the final state", async () => {
		const filePath = join(testDir, "config.json");

		const { session, calls } = createTestSession([
			// Step 1: write the initial file
			toolUseResponse("file_write", {
				path: filePath,
				content: '{"name": "test-app", "version": "1.0.0"}',
			}),
			// Step 2: edit to update version
			toolUseResponse("file_edit", {
				path: filePath,
				old_string: '"1.0.0"',
				new_string: '"2.0.0"',
			}),
			// Step 3: read back to verify
			toolUseResponse("file_read", { path: filePath }),
			// Step 4: confirm
			textResponse("Created config.json and updated version to 2.0.0"),
		]);

		const result = await session.send("Create a config file and update the version");
		session.close();

		expect(calls).toHaveLength(4);

		// File exists and has the correct final content
		expect(existsSync(filePath)).toBe(true);
		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain('"2.0.0"');
		expect(content).not.toContain('"1.0.0"');
		expect(content).toContain('"test-app"');

		// The read-back call (call 4) should contain the edit success result
		const call3Messages = calls[2].messages;
		const hasEditSuccess = call3Messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) =>
						"type" in b &&
						b.type === "tool_result" &&
						"content" in b &&
						typeof b.content === "string" &&
						b.content.includes("Replaced"),
				),
		);
		expect(hasEditSuccess).toBe(true);

		expect(result).toContain("2.0.0");
	});
});

describe("Composition: lint-gated edit recovery", () => {
	let testDir: string;

	beforeEach(() => {
		resetMockIds();
		testDir = makeTempDir("lint");
		writeFileSync(
			join(testDir, "app.js"),
			'function run() {\n  console.log("running");\n}\nmodule.exports = run;\n',
			"utf-8",
		);
	});

	afterEach(() => {
		resetEventBus();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("bad edit is reverted by lint gate, then agent retries with correct syntax", async () => {
		const filePath = join(testDir, "app.js");

		const { session, calls } = createTestSession([
			// Step 1: agent tries an edit that introduces a syntax error
			toolUseResponse("file_edit", {
				path: filePath,
				old_string: 'console.log("running");',
				new_string: 'console.log("running"', // missing closing paren and semicolon
			}),
			// Step 2: agent retries with correct syntax
			toolUseResponse("file_edit", {
				path: filePath,
				old_string: 'console.log("running");',
				new_string: 'console.log("running successfully!");',
			}),
			// Step 3: confirm
			textResponse("Fixed the edit and updated the log message."),
		]);

		const result = await session.send("Update the log message in app.js");
		session.close();

		expect(calls).toHaveLength(3);

		// After the bad edit, the file should have been reverted by the lint gate
		// The second edit should have succeeded
		const finalContent = readFileSync(filePath, "utf-8");
		expect(finalContent).toContain('"running successfully!"');
		expect(finalContent).not.toContain('"running"');

		// Call 2 should have the lint error from call 1
		const call2Messages = calls[1].messages;
		const hasLintError = call2Messages.some(
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
						b.content.includes("reverted"),
				),
		);
		expect(hasLintError).toBe(true);

		// Verify original file was preserved through the revert
		// (the first edit was bad, so the file should have been reverted to original before second edit)
		expect(finalContent).toContain("function run()");

		expect(result).toContain("Fixed");
	});
});

describe("Composition: multi-turn state persistence", () => {
	let testDir: string;

	beforeEach(() => {
		resetMockIds();
		testDir = makeTempDir("multiturn");
	});

	afterEach(() => {
		resetEventBus();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("file created in turn 1 is readable in turn 2, with full context", async () => {
		const filePath = join(testDir, "notes.txt");

		const { session, calls } = createTestSession([
			// Turn 1: write a file
			toolUseResponse("file_write", {
				path: filePath,
				content: "Meeting notes: discuss Q2 roadmap and hiring plan.",
			}),
			textResponse("Created notes.txt with your meeting notes."),
			// Turn 2: read it back
			toolUseResponse("file_read", { path: filePath }),
			textResponse("The file contains: Meeting notes: discuss Q2 roadmap and hiring plan."),
		]);

		// Turn 1
		const result1 = await session.send("Save meeting notes about Q2 roadmap and hiring");
		expect(result1).toContain("Created notes.txt");

		// Turn 2
		const result2 = await session.send("What did I put in that notes file?");
		session.close();

		expect(result2).toContain("Q2 roadmap");

		// Turn 2's API call should include context from turn 1
		// (at minimum: user message, assistant response from turn 1, plus new user message)
		const turn2Call = calls[2]; // 3rd API call is first call of turn 2
		const turn2Messages = turn2Call.messages;

		// Should have messages from turn 1 (user + assistant) plus the new user message
		expect(turn2Messages.length).toBeGreaterThanOrEqual(3);

		// The file should still exist on disk
		expect(existsSync(filePath)).toBe(true);
		expect(readFileSync(filePath, "utf-8")).toContain("Q2 roadmap");
	});
});

describe("Composition: task tracking + shell execution", () => {
	beforeEach(() => {
		resetMockIds();
	});

	afterEach(() => {
		resetEventBus();
	});

	it("agent creates todo, runs shell command, and updates task status", async () => {
		const { session, calls } = createTestSession([
			// Step 1: create a task
			toolUseResponse("todo", {
				action: "add",
				task: "Run the test suite",
				priority: "high",
			}),
			// Step 2: run the shell command
			toolUseResponse("shell", { command: "echo 'All 42 tests passed'" }),
			// Step 3: mark the task done
			toolUseResponse("todo", {
				action: "update",
				id: 1,
				status: "done",
				notes: "All 42 tests passed",
			}),
			// Step 4: confirm
			textResponse("Tests passed and task completed."),
		]);

		const result = await session.send("Run the test suite and track it as a task");
		session.close();

		expect(calls).toHaveLength(4);

		// Call 2 should have the todo-add result
		const call2Messages = calls[1].messages;
		const hasTodoResult = call2Messages.some(
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
		expect(hasTodoResult).toBe(true);

		// Call 3 should have the shell output
		const call3Messages = calls[2].messages;
		const hasShellResult = call3Messages.some(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some(
					(b) =>
						"type" in b &&
						b.type === "tool_result" &&
						"content" in b &&
						typeof b.content === "string" &&
						b.content.includes("42 tests passed"),
				),
		);
		expect(hasShellResult).toBe(true);

		expect(result).toContain("task completed");
	});
});

describe("Composition: parallel tool execution in multi-step workflow", () => {
	let testDir: string;

	beforeEach(() => {
		resetMockIds();
		testDir = makeTempDir("parallel");
		mkdirSync(join(testDir, "src"), { recursive: true });
		writeFileSync(join(testDir, "src", "math.js"), 'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n', "utf-8");
		writeFileSync(join(testDir, "src", "str.js"), 'function upper(s) {\n  return s.toUpperCase();\n}\nmodule.exports = { upper };\n', "utf-8");
	});

	afterEach(() => {
		resetEventBus();
		rmSync(testDir, { recursive: true, force: true });
	});

	it("agent reads two files in parallel, then edits both sequentially", async () => {
		const mathPath = join(testDir, "src", "math.js");
		const strPath = join(testDir, "src", "str.js");

		const { session, calls } = createTestSession([
			// Step 1: read both files in parallel
			multiToolResponse([
				{ name: "file_read", input: { path: mathPath } },
				{ name: "file_read", input: { path: strPath } },
			]),
			// Step 2: edit math.js
			toolUseResponse("file_edit", {
				path: mathPath,
				old_string: "return a + b;",
				new_string: "return Number(a) + Number(b);",
			}),
			// Step 3: edit str.js
			toolUseResponse("file_edit", {
				path: strPath,
				old_string: "return s.toUpperCase();",
				new_string: "return String(s).toUpperCase();",
			}),
			// Step 4: done
			textResponse("Added type safety to both utility functions."),
		]);

		const result = await session.send("Add type coercion to the math and string utilities");
		session.close();

		expect(calls).toHaveLength(4);

		// Both files were modified
		expect(readFileSync(mathPath, "utf-8")).toContain("Number(a)");
		expect(readFileSync(strPath, "utf-8")).toContain("String(s)");

		// Call 2 should have BOTH file_read results from the parallel call
		const call2Messages = calls[1].messages;
		const toolResultMsg = call2Messages.find(
			(m) =>
				m.role === "user" &&
				Array.isArray(m.content) &&
				m.content.some((b) => "type" in b && b.type === "tool_result"),
		);
		expect(toolResultMsg).toBeDefined();
		const resultBlocks = (toolResultMsg!.content as Array<{ type: string }>).filter(
			(b) => b.type === "tool_result",
		);
		expect(resultBlocks).toHaveLength(2);

		expect(result).toContain("type safety");
	});
});
