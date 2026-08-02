import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEventBus } from "#core/events/event-bus.js";
import {
	multiToolResponse,
	resetMockIds,
	textResponse,
	toolUseResponse,
} from "#core/model/mock-client.js";
import {
	createTestSession,
	makeTempDir,
} from "./composition-test-support.js";

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
