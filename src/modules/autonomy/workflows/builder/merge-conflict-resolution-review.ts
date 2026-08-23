import { spawnSync } from "node:child_process";
import { z } from "zod";
import type {
	AgentHarness,
	AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";
import {
	composeCanUseTools,
	createWorkflowAgentGuards,
	shouldRouteKotaToolControl,
} from "#core/agent-harness/index.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { WorkflowAgentHarnessRunner } from "#core/workflow/run-types.js";
import type { WorkflowAgentRunContractSpec } from "#core/workflow/step-types.js";
import { resolveWorkflowAgentRunContract } from "#core/workflow/steps/step-executor-agent-run-contract.js";
import type { MergeGateResolverRequest } from "#modules/git/worktree-merge-gate.js";
import type { showTask } from "#modules/repo-tasks/repo-tasks-operations.js";
import { createMergeConflictResolverToolGuard } from "./merge-conflict-resolver-support.js";

const REVIEW_TRANSCRIPT_LIMIT = 8_000;
const REVIEW_ALLOWED_TOOLS = ["Read", "file_read", "scaffold_search_read"];

const pathJudgmentSchema = z.object({
	path: z.string().trim().min(1),
	decision: z.enum(["preserve-branch", "accept-canonical", "combine"]),
	rationale: z.string().trim().min(1),
}).strict();

const resolutionJudgmentSchema = z.object({
	verdict: z.enum(["resolved", "needs-review"]),
	summary: z.string().trim().min(1),
	taskScopeJustification: z.string().trim().min(1),
	pathJudgments: z.array(pathJudgmentSchema).min(1),
}).strict();

export type MergeConflictResolutionJudgment = z.infer<
	typeof resolutionJudgmentSchema
>;

type TaskContract = Extract<ReturnType<typeof showTask>, { found: true }>;

export type MergeConflictResolutionReview = {
	approved: boolean;
	summary: string;
	subtype?: string;
	transcript: string;
	resolvedDiff: string;
	judgment?: MergeConflictResolutionJudgment;
};

export const MERGE_CONFLICT_REVIEW_SYSTEM_PROMPT = `You are KOTA's read-only merge-resolution reviewer.

Judge the resolved textual conflict against the claimed task, both sides' intent, and the actual resolved diff. Fail closed: use needs-review for ambiguity, unjustified behavior changes, missing intent, or any path whose resolution cannot be explained from the supplied evidence. Do not edit files or run Git mutations.

Return exactly one JSON object with this shape and no markdown:
{"verdict":"resolved|needs-review","summary":"...","taskScopeJustification":"...","pathJudgments":[{"path":"repo/relative/path","decision":"preserve-branch|accept-canonical|combine","rationale":"..."}]}`;

function resolvedConflictDiff(request: MergeGateResolverRequest): string {
	const result = spawnSync(
		"git",
		[
			"diff",
			"--no-ext-diff",
			"--no-color",
			"--",
			...request.conflicts.map((conflict) => conflict.path),
		],
		{
			cwd: request.workspaceDir,
			env: withProtectedGitBareRepositoryEnv(),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	if (result.status !== 0) {
		throw new Error(
			result.stderr.trim() ||
				result.stdout.trim() ||
				"could not render the resolved conflict diff",
		);
	}
	const diff = result.stdout.trim();
	if (!diff) throw new Error("resolved conflict diff is empty");
	return diff;
}

function exactPathJudgments(
	request: MergeGateResolverRequest,
	judgment: MergeConflictResolutionJudgment,
): boolean {
	const expected = [...new Set(request.conflicts.map((conflict) => conflict.path))].sort();
	const actual = [...new Set(judgment.pathJudgments.map((item) => item.path))].sort();
	return actual.length === judgment.pathJudgments.length &&
		actual.length === expected.length &&
		actual.every((path, index) => path === expected[index]);
}

function reviewPrompt(
	request: MergeGateResolverRequest,
	task: TaskContract,
	resolutionSummary: string,
	resolvedDiff: string,
): string {
	return [
		"## Claimed Task Contract",
		task.content.trim(),
		"",
		"## Merge Context",
		`Claimed task: ${request.taskId} (${task.state})`,
		`Branch: ${request.branch}`,
		`Branch head: ${request.headCommit}`,
		`Original base: ${request.baseCommit}`,
		`Canonical head: ${request.canonicalHeadCommit}`,
		"",
		"## Exact Conflict Paths",
		...request.conflicts.map(
			(conflict) => `- ${conflict.path}: ${conflict.reason}`,
		),
		"",
		"## Canonical Diff For Conflict Paths",
		request.canonicalDiff,
		"",
		"## Resolver Summary",
		resolutionSummary,
		"",
		"## Actual Resolved Diff",
		resolvedDiff,
		"",
		"## Review Decision",
		"Return resolved only when every listed path has one justified pathJudgment and the resulting behavior stays within the claimed task.",
	].join("\n");
}

export async function reviewMergeConflictResolution(input: {
	request: MergeGateResolverRequest;
	task: TaskContract;
	resolutionSummary: string;
	harness: AgentHarness;
	agentContract: WorkflowAgentRunContractSpec;
	runAgentHarness: WorkflowAgentHarnessRunner;
	signal?: AbortSignal;
}): Promise<MergeConflictResolutionReview> {
	let resolvedDiff: string;
	try {
		resolvedDiff = resolvedConflictDiff(input.request);
	} catch (error) {
		return {
			approved: false,
			summary: `Merge-resolution review could not inspect the resolved diff: ${error instanceof Error ? error.message : String(error)}`,
			subtype: "resolved-diff-unavailable",
			transcript: "",
			resolvedDiff: "",
		};
	}

	const routedTools = shouldRouteKotaToolControl(input.harness);
	const resolved = resolveWorkflowAgentRunContract({
		step: input.agentContract,
		harness: input.harness,
		model: input.agentContract.model,
		prompt: reviewPrompt(
			input.request,
			input.task,
			input.resolutionSummary,
			resolvedDiff,
		),
		canUseTool: composeCanUseTools(
			createWorkflowAgentGuards(),
			createMergeConflictResolverToolGuard(input.request),
		),
		askOwnerSource: "merge-conflict-resolution-review",
	});
	let transcript = "";
	const reviewOptions: AgentHarnessRunOptions = {
		...resolved.options,
		cwd: input.request.workspaceDir,
		agentWriteScope: "deny-all",
		systemPrompt: MERGE_CONFLICT_REVIEW_SYSTEM_PROMPT,
		...(routedTools ? { allowedTools: REVIEW_ALLOWED_TOOLS } : {}),
	};
	const response = await input.runAgentHarness(
		input.harness,
		reviewOptions,
		{
			signal: input.signal,
			workspaceKey: input.request.workspaceDir,
			writer: {
				write: (text) => {
					transcript = (transcript + text).slice(-REVIEW_TRANSCRIPT_LIMIT);
					return true;
				},
			},
		},
	);
	if (response.isError) {
		return {
			approved: false,
			summary: response.text.trim() || response.subtype || "merge-resolution review failed",
			...(response.subtype !== undefined ? { subtype: response.subtype } : {}),
			transcript: transcript || response.text,
			resolvedDiff,
		};
	}

	let parsed: ReturnType<typeof resolutionJudgmentSchema.safeParse>;
	try {
		parsed = resolutionJudgmentSchema.safeParse(JSON.parse(response.text));
	} catch {
		return {
			approved: false,
			summary: "Merge-resolution review returned invalid structured judgment.",
			subtype: "invalid-resolution-judgment",
			transcript: transcript || response.text,
			resolvedDiff,
		};
	}
	if (!parsed.success) {
		return {
			approved: false,
			summary: "Merge-resolution review returned invalid structured judgment.",
			subtype: "invalid-resolution-judgment",
			transcript: transcript || response.text,
			resolvedDiff,
		};
	}
	if (!exactPathJudgments(input.request, parsed.data)) {
		return {
			approved: false,
			summary: "Merge-resolution review did not justify each exact conflict path once.",
			subtype: "incomplete-path-judgment",
			transcript: transcript || response.text,
			resolvedDiff,
			judgment: parsed.data,
		};
	}
	return {
		approved: parsed.data.verdict === "resolved",
		summary: parsed.data.summary,
		...(parsed.data.verdict === "needs-review"
			? { subtype: "semantic-resolution-needs-review" }
			: {}),
		transcript: transcript || response.text,
		resolvedDiff,
		judgment: parsed.data,
	};
}
