import { describe, expect, it } from "vitest";
import {
	anthropicThinkingTranslator,
	buildMissingReasoningError,
	openaiReasoningEffortTranslator,
} from "./reasoning.js";

describe("openaiReasoningEffortTranslator", () => {
	it("uses the wire surface label openai-reasoning-effort", () => {
		expect(openaiReasoningEffortTranslator.wireSurface).toBe(
			"openai-reasoning-effort",
		);
	});

	it("maps low/medium/high to their o-series values verbatim", () => {
		expect(openaiReasoningEffortTranslator.apply("low")).toEqual({
			reasoning: { effort: "low" },
		});
		expect(openaiReasoningEffortTranslator.apply("medium")).toEqual({
			reasoning: { effort: "medium" },
		});
		expect(openaiReasoningEffortTranslator.apply("high")).toEqual({
			reasoning: { effort: "high" },
		});
	});

	it("collapses xhigh and max onto the o-series high ceiling", () => {
		expect(openaiReasoningEffortTranslator.apply("xhigh")).toEqual({
			reasoning: { effort: "high" },
		});
		expect(openaiReasoningEffortTranslator.apply("max")).toEqual({
			reasoning: { effort: "high" },
		});
	});
});

describe("anthropicThinkingTranslator", () => {
	it("uses the wire surface label anthropic-thinking", () => {
		expect(anthropicThinkingTranslator.wireSurface).toBe("anthropic-thinking");
	});

	it("emits a strictly typed thinking config with an enabled budget", () => {
		const patch = anthropicThinkingTranslator.apply("high");
		expect(patch).toEqual({
			thinking: { type: "enabled", budget_tokens: 16_000 },
		});
	});

	it("scales the token budget monotonically with effort", () => {
		const budget = (e: Parameters<typeof anthropicThinkingTranslator.apply>[0]) =>
			(anthropicThinkingTranslator.apply(e) as {
				thinking: { budget_tokens: number };
			}).thinking.budget_tokens;
		const budgets = [
			budget("low"),
			budget("medium"),
			budget("high"),
			budget("xhigh"),
			budget("max"),
		];
		for (let i = 1; i < budgets.length; i++) {
			expect(budgets[i]).toBeGreaterThan(budgets[i - 1] as number);
		}
	});
});

describe("buildMissingReasoningError", () => {
	it("names the preset, the effort value, and points at claude-agent-sdk", () => {
		const err = buildMissingReasoningError("ollama", "xhigh");
		expect(err.message).toContain('"ollama"');
		expect(err.message).toContain('effort="xhigh"');
		expect(err.message).toContain("claude-agent-sdk");
	});
});
