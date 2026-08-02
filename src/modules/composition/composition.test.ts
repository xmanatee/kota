import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEventBus } from "#core/events/event-bus.js";
import {
	resetMockIds,
	textResponse,
	toolUseResponse,
} from "#core/model/mock-client.js";
import {
	createTestSession,
	makeTempDir,
} from "./composition-test-support.js";

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
