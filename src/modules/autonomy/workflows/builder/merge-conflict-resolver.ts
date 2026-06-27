import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	createWorkflowAgentGuards,
	resolveAgentHarness,
	routeKotaToolControlOptions,
	runAgentHarness,
} from "#core/agent-harness/index.js";
import {
	AUTONOMY_AGENT_DEFAULTS,
	AUTONOMY_AGENT_HARNESS,
	AUTONOMY_DISALLOWED_TOOLS,
} from "#modules/autonomy/shared.js";
import type {
	MergeGateConflict,
	MergeGateResolver,
	MergeGateResolverRequest,
	MergeGateValidation,
} from "#modules/git/worktree-merge-gate.js";

export const MERGE_CONFLICT_RESOLUTION_ATTEMPTS = 2;

const MERGE_CONFLICT_RESOLVER_MAX_TURNS = 8;
const ARTIFACT_TAIL_LIMIT = 2_000;

const SYSTEM_PROMPT = `You are KOTA's bounded merge-conflict resolver.

Resolve only the textual Git conflict files listed by the merge gate. Preserve the intent of both sides when possible, remove conflict markers, and do not stage, commit, merge, rebase, delete worktrees, edit generated files, or touch unrelated paths. The merge gate will stage allowed paths and rerun validation; your self-report is not accepted as proof.`;

export type MergeConflictResolverOptions = {
	runDirPath: string;
	workflowName: string;
	runId: string;
	harnessName?: string;
	model?: string;
};

function tail(value: string): string {
	return value.length <= ARTIFACT_TAIL_LIMIT ? value : value.slice(value.length - ARTIFACT_TAIL_LIMIT);
}

function formatConflicts(conflicts: readonly MergeGateConflict[]): string {
	return conflicts.map((conflict) => `- ${conflict.path}: ${conflict.reason}`).join("\n");
}

function formatValidation(validation: MergeGateValidation | null | undefined): string {
	if (!validation) return "No previous validation result for this attempt.";
	return [
		`Command: ${validation.command.join(" ")}`,
		`Exit code: ${validation.exitCode ?? "null"}`,
		"Stdout tail:",
		validation.stdoutTail || "(empty)",
		"Stderr tail:",
		validation.stderrTail || "(empty)",
	].join("\n");
}

function resolverPrompt(request: MergeGateResolverRequest): string {
	return [
		"## Task",
		"Resolve the listed textual merge conflicts in the current worktree.",
		"",
		`Workspace: ${request.workspaceDir}`,
		`Attempt: ${request.attempt}`,
		"",
		"## Allowed Conflict Files",
		formatConflicts(request.conflicts),
		"",
		"## Previous Validation",
		formatValidation(request.previousValidation),
		"",
		"## Rules",
		"- Edit only the listed conflict files.",
		"- Remove all Git conflict markers.",
		"- Do not run git commit, git merge, git rebase, git reset, or cleanup commands.",
		"- Do not stage files; the merge gate stages the allowed paths after your attempt.",
		"- If validation output is present, use it to correct the listed files.",
		"- Finish with a short plain-text summary of what you changed.",
	].join("\n");
}

function appendAttemptArtifact(
	options: MergeConflictResolverOptions,
	request: MergeGateResolverRequest,
	result: {
		resolved: boolean;
		summary: string;
		isError: boolean;
		subtype?: string;
	},
): void {
	const artifactPath = join(options.runDirPath, "merge-conflict-resolver-attempts.jsonl");
	mkdirSync(dirname(artifactPath), { recursive: true });
	appendFileSync(
		artifactPath,
		`${JSON.stringify({
			workflow: options.workflowName,
			runId: options.runId,
			attempt: request.attempt,
			conflicts: request.conflicts,
			resolved: result.resolved,
			summary: tail(result.summary),
			isError: result.isError,
			...(result.subtype !== undefined ? { subtype: result.subtype } : {}),
			recordedAt: new Date().toISOString(),
		})}\n`,
		"utf8",
	);
}

export function createMergeConflictResolver(options: MergeConflictResolverOptions): MergeGateResolver {
	return async (request) => {
		const harness = resolveAgentHarness(options.harnessName ?? AUTONOMY_AGENT_HARNESS);
		const response = await runAgentHarness(
			harness,
			{
				prompt: resolverPrompt(request),
				model: options.model ?? AUTONOMY_AGENT_DEFAULTS.model,
				cwd: request.workspaceDir,
				systemPrompt: SYSTEM_PROMPT,
				maxTurns: MERGE_CONFLICT_RESOLVER_MAX_TURNS,
				effort: AUTONOMY_AGENT_DEFAULTS.effort,
				...routeKotaToolControlOptions(harness, {
					disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
					canUseTool: createWorkflowAgentGuards(),
				}),
				autonomyMode: "autonomous",
			},
			{ write: () => true },
		);
		const summary = response.text.trim() || response.subtype || "merge resolver produced no summary";
		const result = {
			resolved: !response.isError,
			summary,
			isError: response.isError,
			...(response.subtype !== undefined ? { subtype: response.subtype } : {}),
		};
		appendAttemptArtifact(options, request, result);
		return { resolved: result.resolved, summary };
	};
}
