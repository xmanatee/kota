import {
	type RenderedUntrustedContent,
	renderUntrustedContent,
} from "#core/util/untrusted-content.js";
import type { MergeGateResolverRequest } from "#modules/git/worktree-merge-gate.js";
import type { MergeConflictTaskContract } from "./merge-conflict-task-contract.js";

export type MergeConflictResolutionReviewPrompt = {
	prompt: string;
	screenings: Array<{ source: string; rendered: RenderedUntrustedContent }>;
};

function reviewEvidence(
	screenings: MergeConflictResolutionReviewPrompt["screenings"],
	source: string,
	content: string,
	language: "json" | "text",
): string[] {
	const rendered = renderUntrustedContent({ source, content, language });
	screenings.push({ source, rendered });
	return rendered.lines;
}

export function buildMergeConflictResolutionReviewPrompt(
	request: MergeGateResolverRequest,
	task: MergeConflictTaskContract,
	resolutionSummary: string,
	resolvedDiff: string,
): MergeConflictResolutionReviewPrompt {
	const screenings: MergeConflictResolutionReviewPrompt["screenings"] = [];
	const lines = [
		"## Claimed Task",
		`Claimed task id: ${request.taskId}`,
		`Immutable task contract revision: ${task.revision}`,
		"",
		"## Claimed Task Contract (Untrusted Data)",
		...reviewEvidence(
			screenings,
			"merge-conflict.task-contract",
			task.content.trim(),
			"text",
		),
		"",
		"## Merge Context (Untrusted Data)",
		...reviewEvidence(
			screenings,
			"merge-conflict.merge-context",
			JSON.stringify(
				{
					branch: request.branch,
					branchHead: request.headCommit,
					originalBase: request.baseCommit,
					canonicalHead: request.canonicalHeadCommit,
					taskState: task.state,
					taskPath: task.path,
				},
				null,
				2,
			),
			"json",
		),
		"",
		"## Exact Conflict Paths (Untrusted Data)",
		...reviewEvidence(
			screenings,
			"merge-conflict.conflicts",
			JSON.stringify(request.conflicts, null, 2),
			"json",
		),
		"",
		"## Canonical Diff For Conflict Paths (Untrusted Data)",
		...reviewEvidence(
			screenings,
			"merge-conflict.canonical-diff",
			request.canonicalDiff,
			"text",
		),
		"",
		"## Resolver Summary (Untrusted Data)",
		...reviewEvidence(
			screenings,
			"merge-conflict.resolver-summary",
			resolutionSummary,
			"text",
		),
		"",
		"## Actual Resolved Diff (Untrusted Data)",
		...reviewEvidence(
			screenings,
			"merge-conflict.resolved-diff",
			resolvedDiff,
			"text",
		),
		"",
		"## Review Decision",
		"Return resolved only when every listed path has one justified pathJudgment and the resulting behavior stays within the claimed task.",
	];
	return { prompt: lines.join("\n"), screenings };
}
