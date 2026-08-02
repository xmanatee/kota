import { readFileSync, rmSync, writeFileSync } from "node:fs";
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
