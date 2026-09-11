/**
 * Session delegation and the architect pre-send hook must execute filesystem
 * edits through the real loaded modules. Only model responses are scripted.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEventBus } from "./core/events/event-bus.js";
import { AgentSession } from "./core/loop/loop.js";
import { BufferTransport } from "./core/loop/transport.js";
import {
	createMockClient,
	type MockApiCall,
	textResponse,
	toolUseResponse,
} from "./core/model/mock-client.test-support.js";

vi.spyOn(console, "error").mockImplementation(() => {});

function createTestSession(
	responses: Parameters<typeof createMockClient>[0],
	opts: { verbose?: boolean; architectMode?: boolean } = {},
): { session: AgentSession; transport: BufferTransport; calls: MockApiCall[] } {
	const [client, calls] = createMockClient(responses);
	const transport = new BufferTransport();
	const session = new AgentSession({
		autonomyMode: "autonomous",
		scopeRoot: process.cwd(),
		client,
		transport,
		model: "claude-haiku-4-5-20251001",
		noHistory: true,
		verbose: opts?.verbose ?? false,
		config: opts?.architectMode
			? { modules: { architect: { enabled: true } } }
			: undefined,
	});
	return { session, transport, calls };
}

// ── Delegate E2E Tests ──────────────────────────────────────────────

describe("E2E: delegate sub-agent", () => {
	let filePath: string;

	beforeEach(() => {
		filePath = join(process.cwd(), `.test-delegate-${randomUUID()}.txt`);
	});

	afterEach(() => {
		resetEventBus();
		rmSync(filePath, { force: true });
	});

	it("main loop invokes delegate(execute) which modifies files", async () => {
		
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
		await session.dispose();
		expect(calls).toHaveLength(5);
		// File was actually modified by the delegate's sub-agent
		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain("Universe");
		expect(content).not.toContain("World");
		expect(result).toContain("updated");
	});
});

// ── Architect Mode E2E Tests ────────────────────────────────────────

describe("E2E: architect mode", () => {
	let filePath: string;

	beforeEach(() => {
		filePath = join(process.cwd(), `.test-architect-${randomUUID()}.ts`);
	});

	afterEach(() => {
		resetEventBus();
		rmSync(filePath, { force: true });
	});

	it("architect plans, editor executes, main loop verifies", async () => {
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
		await session.dispose();
		// Architect (1) + editor (3) + main loop (1) = 5 calls
		expect(calls).toHaveLength(5);
		// File was modified by the editor
		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain('"goodbye"');
		expect(content).not.toContain('"hello"');
		expect(result).toContain("greeting");
	});
});
