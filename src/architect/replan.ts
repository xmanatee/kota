/**
 * Adaptive replanning for architect mode.
 *
 * Monitors editor execution for failure patterns and invokes a replanner
 * LLM call when the plan goes off track. Based on AdaPlanner's dual-mode
 * refinement and LangGraph's plan-and-execute pattern.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { CostTracker } from "../core/loop/cost.js";
import type { ModelClient } from "../core/model/model-client.js";

export type ReplanTrigger = "consecutive-errors" | "stagnation";

export type ReplanDecision =
	| { action: "continue" }
	| { action: "revise"; plan: string }
	| { action: "abort"; reason: string };

export type ExecutionStep = {
	tool: string;
	error: string | null;
};

export type FailureTracker = {
	consecutiveErrors: number;
	recentErrors: Array<{ tool: string; error: string }>;
	totalSteps: number;
	replanCount: number;
};

const CONSECUTIVE_ERROR_THRESHOLD = 3;
const STAGNATION_THRESHOLD = 2;
const MAX_REPLANS = 2;

export function createFailureTracker(): FailureTracker {
	return { consecutiveErrors: 0, recentErrors: [], totalSteps: 0, replanCount: 0 };
}

export function recordStep(tracker: FailureTracker, step: ExecutionStep): void {
	tracker.totalSteps++;
	if (step.error) {
		tracker.consecutiveErrors++;
		tracker.recentErrors.push({ tool: step.tool, error: step.error });
	} else {
		tracker.consecutiveErrors = 0;
	}
}

export function detectReplanTrigger(tracker: FailureTracker): ReplanTrigger | null {
	if (tracker.replanCount >= MAX_REPLANS) return null;
	if (tracker.consecutiveErrors >= CONSECUTIVE_ERROR_THRESHOLD) return "consecutive-errors";
	if (detectStagnation(tracker)) return "stagnation";
	return null;
}

function detectStagnation(tracker: FailureTracker): boolean {
	const errors = tracker.recentErrors;
	if (errors.length < STAGNATION_THRESHOLD) return false;
	const last = errors.slice(-STAGNATION_THRESHOLD);
	const first = last[0];
	return last.every((e) => e.tool === first.tool && e.error === first.error);
}

export function buildReplanPrompt(
	originalPlan: string,
	executionSummary: string,
	trigger: ReplanTrigger,
): string {
	const triggerDesc =
		trigger === "consecutive-errors"
			? "Multiple consecutive tool calls have failed."
			: "The same error is repeating — execution appears stuck.";

	return `The execution of the following plan has run into trouble.

## Original Plan
${originalPlan}

## Execution So Far
${executionSummary}

## Problem
${triggerDesc}

## Your Task
Analyze the situation and decide ONE of:

1. **CONTINUE** — The failures are minor/transient and the current plan can still work.
   Reply with exactly: DECISION: CONTINUE

2. **REVISE** — The remaining steps need adjustment based on what was learned.
   Reply with:
   DECISION: REVISE
   Then provide the revised plan for the REMAINING work only (completed steps stay).

3. **ABORT** — The task cannot be completed with available tools/approach.
   Reply with: DECISION: ABORT
   Then explain why in one sentence.`;
}

export function parseReplanDecision(response: string): ReplanDecision {
	const text = response.trim();

	if (text.includes("DECISION: ABORT")) {
		const afterAbort = text.split("DECISION: ABORT")[1]?.trim() || "Task cannot be completed.";
		return { action: "abort", reason: afterAbort.slice(0, 500) };
	}

	if (text.includes("DECISION: REVISE")) {
		const afterRevise = text.split("DECISION: REVISE")[1]?.trim() || "";
		if (afterRevise.length > 0) {
			return { action: "revise", plan: afterRevise };
		}
		return { action: "continue" };
	}

	if (text.includes("DECISION: CONTINUE")) {
		return { action: "continue" };
	}

	// Fallback: if the response contains a plan-like structure, treat as revise
	if (text.includes("Step ") || text.includes("1.") || text.includes("- ")) {
		return { action: "revise", plan: text };
	}

	return { action: "continue" };
}

export function buildExecutionSummary(
	messages: Anthropic.Messages.MessageParam[],
	maxEntries: number = 10,
): string {
	const entries: string[] = [];

	for (const msg of messages) {
		if (typeof msg.content === "string") continue;
		if (!Array.isArray(msg.content)) continue;

		for (const block of msg.content) {
			if (block.type === "tool_use") {
				const tu = block as Anthropic.Messages.ToolUseBlockParam;
				entries.push(`→ ${tu.name}(${JSON.stringify(tu.input).slice(0, 100)})`);
			}
			if (block.type === "tool_result") {
				const tr = block as Anthropic.Messages.ToolResultBlockParam;
				const content = typeof tr.content === "string"
					? tr.content.slice(0, 150)
					: JSON.stringify(tr.content).slice(0, 150);
				const status = tr.is_error ? "ERROR" : "OK";
				entries.push(`  ${status}: ${content}`);
			}
		}
	}

	const tail = entries.slice(-maxEntries * 2);
	return tail.join("\n");
}

export type ReplanOptions = {
	client: ModelClient;
	model: string;
	maxTokens: number;
	originalPlan: string;
	messages: Anthropic.Messages.MessageParam[];
	trigger: ReplanTrigger;
	costTracker?: CostTracker;
};

export async function invokeReplanner(opts: ReplanOptions): Promise<ReplanDecision> {
	const summary = buildExecutionSummary(opts.messages);
	const prompt = buildReplanPrompt(opts.originalPlan, summary, opts.trigger);

	const response = await opts.client.messages.create({
		model: opts.model,
		max_tokens: opts.maxTokens,
		system: "You are a plan evaluator. Analyze the execution state and decide whether to continue, revise, or abort the plan.",
		messages: [{ role: "user", content: prompt }],
	});

	if (opts.costTracker) opts.costTracker.addUsage(opts.model, response.usage);

	const text = response.content
		.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("\n");

	return parseReplanDecision(text);
}
