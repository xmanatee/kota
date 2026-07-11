/**
 * Per-preset reasoning translators.
 *
 * A translator converts the KOTA `AgentEffort` value to the wire-shape patch
 * a specific reasoning surface expects. The factory attaches a translator to
 * each preset that supports reasoning; clients apply the patch at the wire
 * boundary. Presets without a translator cannot express reasoning at all,
 * and throw loudly when `effort` is set.
 */

import type { AgentEffort } from "#core/model/model-client.js";

/** Shape of a reasoning-control patch merged into a streaming request body. */
export type ReasoningWirePatch = Record<string, unknown>;

/** Translator that converts `AgentEffort` to a wire-shape patch for one preset. */
export type EffortTranslator = {
	/** Operator-facing label for the reasoning surface (e.g. `openai-reasoning-effort`). */
	readonly wireSurface: string;
	apply(effort: AgentEffort): ReasoningWirePatch;
};

/**
 * Reasoning translator for OpenAI Chat Completions. Model-specific support is
 * validated by the provider instead of silently lowering a requested quality
 * level.
 */
export const openaiReasoningEffortTranslator: EffortTranslator = {
	wireSurface: "openai-reasoning-effort",
	apply(effort) {
		return { reasoning_effort: effort };
	},
};

/**
 * OpenRouter supports OpenAI-compatible `reasoning.effort`, including `xhigh`.
 * `max` is the only KOTA effort literal OpenRouter does not expose directly.
 */
const OPENROUTER_EFFORT_MAP: Record<
	AgentEffort,
	"low" | "medium" | "high" | "xhigh"
> = {
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "xhigh",
};

export const openrouterReasoningEffortTranslator: EffortTranslator = {
	wireSurface: "openrouter-reasoning-effort",
	apply(effort) {
		return { reasoning: { effort: OPENROUTER_EFFORT_MAP[effort] } };
	},
};

/**
 * Thinking-budget token counts per effort level. Chosen to mirror the
 * magnitudes a claude-agent-sdk `thinking: adaptive` run tends to allocate
 * at comparable effort settings; presets that want tighter limits attach a
 * different translator.
 */
const ANTHROPIC_THINKING_BUDGET_TOKENS: Record<AgentEffort, number> = {
	low: 2_000,
	medium: 8_000,
	high: 16_000,
	xhigh: 32_000,
	max: 64_000,
};

/**
 * Reasoning translator for endpoints that honor Anthropic's `thinking`
 * parameter — native Anthropic SDK or any OpenAI-compatible wrapper that
 * proxies through to the Claude API.
 */
export const anthropicThinkingTranslator: EffortTranslator = {
	wireSurface: "anthropic-thinking",
	apply(effort) {
		return {
			thinking: {
				type: "enabled",
				budget_tokens: ANTHROPIC_THINKING_BUDGET_TOKENS[effort],
			},
		};
	},
};

/**
 * Build the exact error raised when a caller sets `effort` against a preset
 * that has no declared reasoning mapping. The message names the preset and
 * points at `claude-agent-sdk` so operators know where a reasoning-capable
 * run actually lives.
 */
export function buildMissingReasoningError(
	presetName: string,
	effort: AgentEffort,
): Error {
	return new Error(
		`Model preset "${presetName}" has no reasoning-effort mapping; ` +
			`effort="${effort}" cannot be honored. Pick a reasoning-capable preset ` +
			'(the `openai`, `openrouter`, or `anthropic` presets expose one) or run the ' +
			"`claude-agent-sdk` harness which hosts extended thinking natively.",
	);
}
