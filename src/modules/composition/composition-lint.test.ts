import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEventBus } from "#core/events/event-bus.js";
import {
	textResponse,
	toolUseResponse,
} from "#core/model/mock-client.test-support.js";
import {
	createTestSession,
	makeTempDir,
} from "./composition-test-support.js";

describe("Composition: incremental file editing", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = makeTempDir("incremental-edit");
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

	it("retains unfinished syntax so a follow-up edit can complete it", async () => {
		const filePath = join(testDir, "app.js");

		const { session, calls } = createTestSession([
			toolUseResponse(
				"file_edit",
				{
					path: filePath,
					old_string: 'console.log("running");',
					new_string: 'console.log("running"',
				},
				{ toolId: "unfinished-edit" },
			),
			toolUseResponse("file_edit", {
				path: filePath,
				old_string: 'console.log("running"',
				new_string: 'console.log("running successfully!");',
			}),
			textResponse("Updated the log message."),
		]);

		try {
			const result = await session.send("Update the log message in app.js");
			expect(calls).toHaveLength(3);
			expect(readFileSync(filePath, "utf-8")).toBe(
				'function run() {\n  console.log("running successfully!");\n}\nmodule.exports = run;\n',
			);

			const editResult = calls[1].messages
				.flatMap((message) =>
					message.role === "user" && Array.isArray(message.content)
						? message.content
						: [],
				)
				.find((block) => block.type === "tool_result" && block.tool_use_id === "unfinished-edit");
			expect(editResult).toMatchObject({
				type: "tool_result",
				content: expect.stringContaining("Replaced 1 occurrence(s)"),
			});
			expect(editResult).not.toHaveProperty("is_error", true);
			expect(result).toContain("Updated");
		} finally {
			session.close();
		}
	});
});
