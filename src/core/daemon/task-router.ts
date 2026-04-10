/**
 * Task-type detection and strategy routing.
 * Classifies user requests by intent and provides task-specific
 * strategy hints and tool group recommendations.
 *
 * Zero LLM cost — pure pattern matching.
 */

import {
	GROUP_RECOMMENDATIONS,
	STRATEGIES,
	TASK_PATTERNS,
} from "./task-router-data.js";

export type TaskType =
	| "research"
	| "coding"
	| "data_analysis"
	| "writing"
	| "planning"
	| "debugging"
	| "automation"
	| "general";

export type TaskRoute = {
	type: TaskType;
	/** Recommended tool groups to auto-enable. */
	groups: string[];
	/** Compact strategy hint for the LLM. */
	strategy: string;
};

const MIN_PROMPT_LENGTH = 15;
const MIN_SCORE = 2;

/**
 * Classify a user prompt by task type and return routing info.
 * Returns null for very short or unclassifiable messages.
 */
export function routeTask(prompt: string): TaskRoute | null {
	if (prompt.length < MIN_PROMPT_LENGTH) return null;

	let bestType: TaskType = "general";
	let bestScore = 0;

	for (const [type, patterns] of Object.entries(TASK_PATTERNS)) {
		let score = 0;
		for (const { pattern, weight } of patterns) {
			if (pattern.test(prompt)) score += weight;
		}
		if (score > bestScore) {
			bestScore = score;
			bestType = type as TaskType;
		}
	}

	if (bestType === "general" || bestScore < MIN_SCORE) return null;

	return {
		type: bestType,
		groups: GROUP_RECOMMENDATIONS[bestType],
		strategy: STRATEGIES[bestType],
	};
}

/**
 * Format a task route into a compact hint appended to the user message.
 * Returns empty string if no route or no strategy.
 */
export function formatTaskHint(route: TaskRoute | null): string {
	if (!route?.strategy) return "";
	return `\n\n[Task: ${route.type.replace("_", " ")} — ${route.strategy}]`;
}
