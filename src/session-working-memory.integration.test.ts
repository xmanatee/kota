/**
 * A module tool write must reach the next session turn through the loaded
 * dynamic-state provider. The model port captures the actual system prompt.
 */

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
import { resetWorkingMemory } from "./modules/working-memory/store.js";

vi.spyOn(console, "error").mockImplementation(() => {});

function createTestSession(
	responses: Parameters<typeof createMockClient>[0],
): { session: AgentSession; transport: BufferTransport; calls: MockApiCall[] } {
	const [client, calls] = createMockClient(responses);
	const transport = new BufferTransport();
	const session = new AgentSession({
		autonomyMode: "autonomous",
		client,
		transport,
		model: "claude-haiku-4-5-20251001",
		noHistory: true,
		reflectionEnabled: false,
		verbose: false,
	});
	return { session, transport, calls };
}

describe("Module E2E: working memory → system prompt", () => {
	beforeEach(() => {
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
		await session.dispose();
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
});
