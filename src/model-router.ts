/**
 * Adaptive model routing — selects model tier based on task complexity.
 *
 * Maps task classification (from task-router) + complexity signals to
 * a model tier (fast/balanced/capable), then resolves to a concrete model.
 * Used by delegate to auto-select cost-appropriate models for sub-agents.
 */

import { routeTask, type TaskType } from "./task-router.js";

export type ModelTier = "fast" | "balanced" | "capable";

export type ModelTiers = {
	fast?: string;
	balanced?: string;
	capable?: string;
};

export const DEFAULT_MODEL_TIERS: Required<ModelTiers> = {
	fast: "claude-haiku-4-5-20251001",
	balanced: "claude-sonnet-4-6",
	capable: "claude-opus-4-6",
};

/** Base tier for each task type — before complexity adjustments. */
const TASK_TYPE_TIERS: Record<TaskType, ModelTier> = {
	research: "fast",
	writing: "fast",
	data_analysis: "balanced",
	coding: "balanced",
	debugging: "balanced",
	automation: "balanced",
	planning: "capable",
	general: "balanced",
};

const TIER_ORDER: ModelTier[] = ["fast", "balanced", "capable"];

/** Patterns that signal higher complexity — each match upgrades one tier. */
const COMPLEXITY_PATTERNS: RegExp[] = [
	/\b(architect|architecture|design\s+system|system\s+design)\b/i,
	/\b(multi[- ]?(file|step|stage|phase|service))\b/i,
	/\b(trade[- ]?offs?|security\s+review|performance\s+audit)\b/i,
	/\b(refactor\s+(entire|whole|all|across)|cross[- ]cutting)\b/i,
	/\b(optimize|concurrent|parallel\s+processing|distributed)\b/i,
];

/** Patterns that signal lower complexity — each match downgrades one tier. */
const SIMPLICITY_PATTERNS: RegExp[] = [
	/\b(look\s+up|find\s+(the|a)|search\s+for|list\s+(all|the))\b/i,
	/\b(what\s+is|how\s+to|explain|describe|summarize)\b/i,
	/\b(read\s+(the|this)\s+file|check\s+(the|this)|quick\s+look)\b/i,
];

function clampTier(index: number): ModelTier {
	return TIER_ORDER[Math.max(0, Math.min(index, TIER_ORDER.length - 1))];
}

export type DelegateBackend = "thin" | "agent-sdk";

export type ModelRouteResult = {
	tier: ModelTier;
	model: string;
	taskType: TaskType | null;
	reason: string;
	backend: DelegateBackend;
};

/**
 * Select a model tier for a delegate sub-agent task.
 *
 * Combines task-type classification with complexity/simplicity signals
 * and delegate mode. Execute mode gets a +1 tier bump (edits are riskier).
 */
export function routeModel(
	task: string,
	mode: "explore" | "execute",
	tiers?: ModelTiers,
	fallback?: string,
): ModelRouteResult {
	const resolved = { ...DEFAULT_MODEL_TIERS, ...tiers };
	const route = routeTask(task);
	const taskType = route?.type ?? "general";
	let tierIndex = TIER_ORDER.indexOf(TASK_TYPE_TIERS[taskType]);

	// Complexity signals: each match shifts tier up
	for (const pattern of COMPLEXITY_PATTERNS) {
		if (pattern.test(task)) {
			tierIndex++;
			break; // cap at +1 from complexity
		}
	}

	// Simplicity signals: each match shifts tier down
	for (const pattern of SIMPLICITY_PATTERNS) {
		if (pattern.test(task)) {
			tierIndex--;
			break; // cap at -1 from simplicity
		}
	}

	// Execute mode bump: edits carry more risk → prefer more capable model
	if (mode === "execute") {
		tierIndex++;
	}

	const tier = clampTier(tierIndex);
	const model = resolved[tier] || fallback || resolved.balanced;

	// Route to Agent SDK for execute-mode coding/debugging/automation at capable tier
	const SDK_ELIGIBLE_TYPES: Set<TaskType> = new Set(["coding", "debugging", "automation"]);
	const backend: DelegateBackend =
		mode === "execute" && SDK_ELIGIBLE_TYPES.has(taskType) && tier === "capable"
			? "agent-sdk"
			: "thin";

	const parts: string[] = [`type=${taskType}`];
	if (mode === "execute") parts.push("execute+1");
	parts.push(`→${tier}`);
	if (backend === "agent-sdk") parts.push("sdk");

	return { tier, model, taskType, reason: parts.join(", "), backend };
}

/**
 * Resolve a tier to a concrete model string.
 * Falls back through: tier config → fallback → balanced default.
 */
export function resolveModelForTier(
	tier: ModelTier,
	tiers?: ModelTiers,
	fallback?: string,
): string {
	const resolved = { ...DEFAULT_MODEL_TIERS, ...tiers };
	return resolved[tier] || fallback || resolved.balanced;
}
