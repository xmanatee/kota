/**
 * Session startup, registered filesystem tools and context masking compose
 * through real AgentSession.send calls with a scripted model port.
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

	textResponse,
	toolUseResponse,
} from "./core/model/mock-client.test-support.js";

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
		autonomyMode: "autonomous",
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
		await session.dispose();
		expect(result).toBe("Hello! How can I help you?");
		// Transport should have received text events
		const textEvents = transport.events.filter((e) => e.type === "text");
		expect(textEvents.length).toBeGreaterThan(0);
		const textContent = textEvents.map((e) => "content" in e ? e.content : "").join("");
		expect(textContent).toContain("Hello! How can I help you?");
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
		await session.dispose();
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
		await session.dispose();
		expect(existsSync(outFile)).toBe(true);
		expect(readFileSync(outFile, "utf-8")).toBe("Generated content");
		rmSync(testDir, { recursive: true, force: true });
	});
});

describe("E2E: observation masking", () => {
	beforeEach(() => {

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
		await session.dispose();
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
