import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AgentHarness,
	UNKNOWN_AGENT_USAGE,
	unpricedAgentUsage,
} from "#core/agent-harness/index.js";
import {
	runAgentHarnessWithConversationResume,
	transcriptFromKotaMessages,
} from "./harness-resume.js";
import { ConversationHistory } from "./history.js";
import { getProjectHistoryDir } from "./history-utils.js";

function transcriptFixtureMessages() {
	return [
		{ role: "user" as const, content: "original question" },
		{ role: "assistant" as const, content: "original answer" },
	];
}

function makeHarness(run: AgentHarness["run"]): AgentHarness {
	return {
		name: "test-harness",
		description: "Test harness",
		supportsMultiTurn: true,
		supportedHookKinds: ["preRun", "postRun"],
		askOwnerToolName: null,
		emitsAgentMessageStream: false,
		toolControl: "kota",
		run,
	};
}

describe("harness conversation resume", () => {
	let projectDir: string;

	beforeEach(() => {
		projectDir = mkdtempSync(join(tmpdir(), "kota-harness-resume-"));
		vi.clearAllMocks();
	});

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true });
	});

	it("runs plain harness calls without reading conversation history", async () => {
		const run = vi.fn<AgentHarness["run"]>(async () => ({
			text: "plain answer",
			streamedText: "plain answer",
			turns: 1,
			usage: UNKNOWN_AGENT_USAGE,
			isError: false,
		}));
		const harness = makeHarness(run);

		await runAgentHarnessWithConversationResume({
			harness,
			prompt: "new prompt",
			run: { effort: "xhigh", model: "model" },
		});

		expect(run.mock.calls[0]?.[0]).toMatchObject({
			prompt: "new prompt",
			model: "model",
		});
	});

	it("restores and updates the KOTA conversation through the history store", async () => {
		const run = vi.fn<AgentHarness["run"]>(async () => ({
			text: "continued answer",
			streamedText: "continued answer",
			turns: 1,
			usage: unpricedAgentUsage(123, undefined),
			isError: false,
		}));
		const harness = makeHarness(run);
		const history = new ConversationHistory(getProjectHistoryDir(projectDir));
		const conversationId = history.create("model", projectDir);
		history.save(conversationId, transcriptFixtureMessages(), 0, 0);

		await runAgentHarnessWithConversationResume({
			harness,
			prompt: "continue now",
			run: { effort: "xhigh", model: "model" },
			conversation: {
				autonomyMode: "passive",
				model: "model",
				resumeConversation: conversationId,
				projectDir,
			},
		});

		const prompt = run.mock.calls[0]?.[0].prompt;
		expect(prompt).toContain("original question");
		expect(prompt).toContain("original answer");
		expect(prompt).toContain("continue now");
		const updated = history.load(conversationId);
		expect(updated?.messages).toEqual([
			...transcriptFixtureMessages(),
			{ role: "user", content: "continue now" },
			{ role: "assistant", content: "continued answer" },
		]);
		expect(updated?.lastInputTokens).toBe(123);
	});

	it("converts stored KOTA messages into harness REPL turns", () => {
		expect(transcriptFromKotaMessages(transcriptFixtureMessages())).toEqual([
			{ user: "original question", assistant: "original answer" },
		]);
	});
});
