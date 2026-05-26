import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentHarness } from "#core/agent-harness/index.js";
import type { LoopOptions } from "#core/loop/loop.js";
import {
	runAgentHarnessWithConversationResume,
	transcriptFromKotaMessages,
} from "./harness-resume.js";

const { constructedSessions } = vi.hoisted(() => ({
	constructedSessions: [] as FakeSession[],
}));

type FakeSession = {
	options: LoopOptions;
	initPromise: Promise<void>;
	context: {
		getMessages: () => ReturnType<typeof transcriptFixtureMessages>;
		addUserMessage: ReturnType<typeof vi.fn>;
		addAssistantText: ReturnType<typeof vi.fn>;
		setInputTokens: ReturnType<typeof vi.fn>;
	};
	close: ReturnType<typeof vi.fn>;
};

function transcriptFixtureMessages() {
	return [
		{ role: "user" as const, content: "original question" },
		{ role: "assistant" as const, content: "original answer" },
	];
}

vi.mock("#core/loop/loop.js", () => ({
	AgentSession: class {
		options: LoopOptions;
		initPromise = Promise.resolve();
		context = {
			getMessages: vi.fn(() => transcriptFixtureMessages()),
			addUserMessage: vi.fn(),
			addAssistantText: vi.fn(),
			setInputTokens: vi.fn(),
		};
		close = vi.fn();

		constructor(options: LoopOptions) {
			this.options = options;
			constructedSessions.push(this as FakeSession);
		}
	},
}));

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
	beforeEach(() => {
		constructedSessions.length = 0;
		vi.clearAllMocks();
	});

	it("runs plain harness calls without constructing an AgentSession", async () => {
		const run = vi.fn<AgentHarness["run"]>(async () => ({
			text: "plain answer",
			streamedText: "plain answer",
			turns: 1,
			isError: false,
		}));
		const harness = makeHarness(run);

		await runAgentHarnessWithConversationResume({
			harness,
			prompt: "new prompt",
			run: { effort: "xhigh", model: "model" },
		});

		expect(constructedSessions).toHaveLength(0);
		expect(run.mock.calls[0]?.[0]).toMatchObject({
			prompt: "new prompt",
			model: "model",
		});
	});

	it("restores the KOTA conversation into an AgentSession before running the harness", async () => {
		const run = vi.fn<AgentHarness["run"]>(async () => ({
			text: "continued answer",
			streamedText: "continued answer",
			turns: 1,
			inputTokens: 123,
			isError: false,
		}));
		const harness = makeHarness(run);

		await runAgentHarnessWithConversationResume({
			harness,
			prompt: "continue now",
			run: { effort: "xhigh", model: "model" },
			conversation: {
				autonomyMode: "passive",
				model: "model",
				resumeConversation: "conv-1",
				projectDir: "/saved/project",
			},
		});

		expect(constructedSessions).toHaveLength(1);
		expect(constructedSessions[0]?.options).toMatchObject({
			resumeConversation: "conv-1",
			projectDir: "/saved/project",
		});
		const prompt = run.mock.calls[0]?.[0].prompt;
		expect(prompt).toContain("original question");
		expect(prompt).toContain("original answer");
		expect(prompt).toContain("continue now");
		expect(constructedSessions[0]?.context.addUserMessage).toHaveBeenCalledWith(
			"continue now",
		);
		expect(constructedSessions[0]?.context.addAssistantText).toHaveBeenCalledWith(
			"continued answer",
		);
		expect(constructedSessions[0]?.context.setInputTokens).toHaveBeenCalledWith(
			123,
		);
		expect(constructedSessions[0]?.close).toHaveBeenCalledWith(false);
	});

	it("converts stored KOTA messages into harness REPL turns", () => {
		expect(transcriptFromKotaMessages(transcriptFixtureMessages())).toEqual([
			{ user: "original question", assistant: "original answer" },
		]);
	});
});
