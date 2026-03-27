import type { TaskType } from "./task-router.js";

export type PatternEntry = { pattern: RegExp; weight: number };

export const TASK_PATTERNS: Record<Exclude<TaskType, "general">, PatternEntry[]> = {
	research: [
		{
			pattern:
				/\b(research|investigate|survey|explore\s+options|look\s*into|find\s+out\s+(about|what|how|why))\b/i,
			weight: 3,
		},
		{
			pattern:
				/\b(compare|comparison|pros?\s+and\s+cons|alternatives|benchmark|evaluate\s+options)\b/i,
			weight: 3,
		},
		{
			pattern:
				/\b(what\s+are\s+the\s+(best|top|main|key)|best\s+practices|state\s+of\s+the\s+art)\b/i,
			weight: 2,
		},
		{
			pattern:
				/\b(latest|current|recent)\s+(news|trends?|updates?|developments?|releases?)\b/i,
			weight: 2,
		},
		{ pattern: /\b(summarize|overview|landscape|deep\s+dive)\b/i, weight: 1 },
	],
	coding: [
		{
			pattern:
				/\b(implement|build|write\s+code|code\s+up|create\s+a\s+(function|class|module|component|api|endpoint|service))\b/i,
			weight: 3,
		},
		{
			pattern: /\b(add\s+(a\s+)?feature|new\s+feature|extend|enhancement)\b/i,
			weight: 2,
		},
		{
			pattern: /\b(refactor|rewrite|restructure|migrate|port\s+to)\b/i,
			weight: 2,
		},
		{
			pattern:
				/\b(write\s+(\w+\s+)?tests?|add\s+(\w+\s+)?tests?|test\s+coverage|unit\s+tests?|integration\s+tests?|e2e\s+tests?)\b/i,
			weight: 2,
		},
		{
			pattern:
				/\b(typescript|javascript|python|rust|golang|react|vue|angular|node\.?js)\b/i,
			weight: 1,
		},
	],
	data_analysis: [
		{
			pattern: /\b(analy[sz]e\s+(the\s+)?(data|dataset|numbers|metrics))\b/i,
			weight: 3,
		},
		{
			pattern:
				/\b(csv|tsv|dataset|data\s*set|dataframe|spreadsheet|excel)\b/i,
			weight: 3,
		},
		{
			pattern:
				/\b(chart|graph|plot|visuali[sz]|histogram|scatter|heatmap|distribution)\b/i,
			weight: 2,
		},
		{
			pattern:
				/\b(correlat\w*|regression|trend|outliers?|aggregat\w*|pivot|group\s*by|percentile)\b/i,
			weight: 2,
		},
		{ pattern: /\b(forecast|predict\w*|metrics?|kpi|dashboard)\b/i, weight: 1 },
	],
	writing: [
		{
			pattern:
				/\b(write|draft|compose)\s+(an?\s+)?(email|blog|article|post|essay|letter|memo|proposal|report|document)\b/i,
			weight: 3,
		},
		{
			pattern:
				/\b(proofread|edit\s+my\s+(writing|text|draft)|rewrite\s+this|rephrase)\b/i,
			weight: 3,
		},
		{
			pattern:
				/\b(documentation|readme|changelog|release\s+notes|user\s+guide)\b/i,
			weight: 2,
		},
		{
			pattern: /\b(outline|structure|table\s+of\s+contents|sections?\s+for)\b/i,
			weight: 1,
		},
		{
			pattern: /\b(tone|voice|audience|persuasive|formal|informal)\b/i,
			weight: 1,
		},
	],
	planning: [
		{
			pattern:
				/\b(plan\s+(for|out|the)|roadmap|strategy|strategic\s+plan)\b/i,
			weight: 3,
		},
		{
			pattern:
				/\b(project\s+plan|task\s+breakdown|work\s*breakdown|sprint\s+plan|milestones?)\b/i,
			weight: 3,
		},
		{
			pattern: /\b(prioriti[sz]e|timeline|deadline|phases?|stages?)\b/i,
			weight: 2,
		},
		{
			pattern:
				/\b(design\s+(the\s+)?(architecture|system|api|schema|database))\b/i,
			weight: 2,
		},
		{
			pattern:
				/\b(trade.?offs?|constraints?|requirements?\s+gathering|scope|estimate\s+effort)\b/i,
			weight: 1,
		},
	],
	debugging: [
		{
			pattern:
				/\b(debug|bug|error|exception|failing|broken|not\s+working|crash(es|ed|ing)?)\b/i,
			weight: 3,
		},
		{
			pattern:
				/\b(stack\s*trace|traceback|segfault|panic|undefined\s+is\s+not|cannot\s+read\s+propert)/i,
			weight: 3,
		},
		{
			pattern:
				/\b(troubleshoot|diagnose|root\s+cause|figure\s+out\s+why|investigate\s+the\s+(issue|problem|error))\b/i,
			weight: 2,
		},
		{
			pattern:
				/\b(regression|flaky|intermittent|race\s+condition|memory\s+leak|deadlock)\b/i,
			weight: 2,
		},
		{
			pattern:
				/\b(why\s+(does|is|did)\s+\S+\s+(fail|break|error|throw|crash))\b/i,
			weight: 1,
		},
	],
	automation: [
		{
			pattern: /\b(automate|automation|workflow|pipeline)\b/i,
			weight: 3,
		},
		{
			pattern:
				/\b(schedule|cron|recurring|periodic|every\s+\d+\s+(minute|hour|day|week))\b/i,
			weight: 3,
		},
		{
			pattern:
				/\b(monitor|watch\s+for|alert\s+when|notify\s+when|trigger\s+on)\b/i,
			weight: 2,
		},
		{
			pattern:
				/\b(batch\s+process|bulk\s+operation|ci\s*\/?\s*cd|deploy|script\s+to)\b/i,
			weight: 2,
		},
		{
			pattern: /\b(webhook|integration|connect\s+to)\b/i,
			weight: 1,
		},
	],
};

/** Compact strategy hints per task type. Actionable, not generic. */
export const STRATEGIES: Record<TaskType, string> = {
	research:
		"Delegate parallel searches on different angles. Compare 3+ sources with dates. Save key findings to knowledge store.",
	coding:
		"Start with repo_map. Group related changes. Run tests after each edit. Use architect mode for 3+ file changes.",
	data_analysis:
		"Inspect shape/types first with code_exec. Visualize before concluding. Use notebook for reproducible analysis.",
	writing:
		"Clarify audience and format. Outline before drafting. Save to file. Read back and revise before delivering.",
	planning:
		"Define constraints first. Generate 2-3 options with trade-off table. Track execution with todo.",
	debugging:
		"Read the full error. Grep for context around the failure. Test hypothesis in code_exec before applying fix.",
	automation:
		"Prototype steps interactively. Save as script with error handling. Test edge cases before scheduling.",
	general: "",
};

/** Tool groups most useful for each task type. */
export const GROUP_RECOMMENDATIONS: Record<TaskType, string[]> = {
	research: ["web", "management", "orchestration"],
	coding: ["advanced_editing", "code"],
	data_analysis: ["code", "orchestration"],
	writing: [],
	planning: ["management"],
	debugging: ["code"],
	automation: ["management", "code", "web", "orchestration"],
	general: [],
};
