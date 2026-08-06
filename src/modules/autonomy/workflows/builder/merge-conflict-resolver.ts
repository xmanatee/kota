import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
	type AgentCanUseTool,
	type AgentPermissionResult,
	composeCanUseTools,
	createWorkflowAgentGuards,
	hasAgentHarness,
	resolveAgentHarness,
	shouldRouteKotaToolControl,
} from "#core/agent-harness/index.js";
import type { AgentRuntimeSelection } from "#core/model/preset.js";
import type { WorkflowAgentHarnessRunner } from "#core/workflow/run-types.js";
import type { WorkflowAgentRunContractSpec } from "#core/workflow/step-types.js";
import { resolveWorkflowAgentRunContract } from "#core/workflow/steps/step-executor-agent-run-contract.js";
import {
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
const UNSUPPORTED_TOOL_CONTROL_SUBTYPE = "unsupported-tool-control";
export const MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS = [
	"Read",
	"Edit",
	"MultiEdit",
	"file_read",
	"file_edit",
	"scaffold_search_read",
	"scaffold_edit",
] as const;
const MERGE_CONFLICT_RESOLVER_ALLOWED_TOOL_SET = new Set<string>(MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS);
const MERGE_CONFLICT_RESOLVER_TOOL_DENIAL =
	"Merge-conflict resolver may only use file read/edit tools on listed textual conflict files.";
type MergeConflictResolverToolInput = Parameters<AgentCanUseTool>[1];

const SYSTEM_PROMPT = `You are KOTA's bounded merge-conflict resolver.

Resolve only the textual Git conflict files listed by the merge gate. Preserve the intent of both sides when possible, remove conflict markers, and do not stage, commit, merge, rebase, delete worktrees, edit generated files, or touch unrelated paths. The merge gate will stage allowed paths and rerun validation; your self-report is not accepted as proof.`;

export type MergeConflictResolverOptions = {
	runDirPath: string;
	workflowName: string;
	runId: string;
	agentContract: WorkflowAgentRunContractSpec;
	runAgentHarness: WorkflowAgentHarnessRunner;
	signal?: AbortSignal;
};

export function resolveMergeConflictResolverRunContract(
	runtime: AgentRuntimeSelection,
): WorkflowAgentRunContractSpec {
	const harness = hasAgentHarness(runtime.harness)
		? resolveAgentHarness(runtime.harness)
		: undefined;
	return {
		harness: runtime.harness,
		model: runtime.tiers.capable,
		effort: runtime.effort,
		maxTurns: MERGE_CONFLICT_RESOLVER_MAX_TURNS,
		autonomyMode: "autonomous",
		ownerQuestionAccess: "disabled",
		...(harness && shouldRouteKotaToolControl(harness)
			? {
				allowedTools: [...MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS],
				disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
			}
			: {}),
	};
}

function tail(value: string): string {
	return value.length <= ARTIFACT_TAIL_LIMIT ? value : value.slice(value.length - ARTIFACT_TAIL_LIMIT);
}

function formatConflicts(conflicts: readonly MergeGateConflict[]): string {
	return conflicts.map((conflict) => `- ${conflict.path}: ${conflict.reason}`).join("\n");
}

function toPortablePath(path: string): string {
	return path.split(/[\\/]+/).join("/");
}

function workspaceRelativePath(workspaceDir: string, path: string): string | null {
	const trimmed = path.trim();
	if (!trimmed) return null;
	const workspace = resolve(workspaceDir);
	const absolutePath = isAbsolute(trimmed) ? resolve(trimmed) : resolve(workspace, trimmed);
	const relativePath = relative(workspace, absolutePath);
	if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
	return toPortablePath(relativePath);
}

function conflictPathSet(request: MergeGateResolverRequest): Set<string> {
	const allowed = new Set<string>();
	for (const conflict of request.conflicts) {
		const path = workspaceRelativePath(request.workspaceDir, conflict.path);
		if (!path) {
			throw new Error(`Merge conflict path escapes resolver workspace: ${conflict.path}`);
		}
		allowed.add(path);
	}
	return allowed;
}

function stringInput(input: MergeConflictResolverToolInput, key: string): string | null {
	const value = input[key];
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArrayInput(input: MergeConflictResolverToolInput, key: string): string[] {
	const value = input[key];
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function toolTargetPaths(toolName: string, input: MergeConflictResolverToolInput): string[] {
	if (toolName === "scaffold_search_read") return stringArrayInput(input, "read_paths");
	const directPath = stringInput(input, "file_path") ?? stringInput(input, "path");
	return directPath ? [directPath] : [];
}

function deny(message = MERGE_CONFLICT_RESOLVER_TOOL_DENIAL): AgentPermissionResult {
	return {
		behavior: "deny",
		message,
		decisionAttribution: "operator-deny",
	};
}

export function createMergeConflictResolverToolGuard(request: MergeGateResolverRequest): AgentCanUseTool {
	const allowedConflictPaths = conflictPathSet(request);
	return async (toolName, input): Promise<AgentPermissionResult> => {
		if (!MERGE_CONFLICT_RESOLVER_ALLOWED_TOOL_SET.has(toolName)) return deny();
		const targetPaths = toolTargetPaths(toolName, input);
		if (targetPaths.length === 0) {
			return deny(`Merge-conflict resolver tool "${toolName}" must target a listed textual conflict file.`);
		}
		for (const targetPath of targetPaths) {
			const normalizedPath = workspaceRelativePath(request.workspaceDir, targetPath);
			if (!normalizedPath || !allowedConflictPaths.has(normalizedPath)) {
				return deny(
					`Merge-conflict resolver denied access to "${targetPath}"; only listed textual conflict files are allowed.`,
				);
			}
		}
		return { behavior: "allow", updatedInput: input };
	};
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
		const harness = resolveAgentHarness(options.agentContract.harness);
		if (!shouldRouteKotaToolControl(harness)) {
			const summary =
				`Merge-conflict resolver was not dispatched because harness "${harness.name}" declares ` +
				`"${harness.toolControl}" tool control, so KOTA cannot enforce the bounded conflict-file guard; ` +
				"the merge remains pending for recovery review.";
			appendAttemptArtifact(options, request, {
				resolved: false,
				summary,
				isError: false,
				subtype: UNSUPPORTED_TOOL_CONTROL_SUBTYPE,
			});
			return { resolved: false, summary };
		}
		const resolved = resolveWorkflowAgentRunContract({
			step: options.agentContract,
			harness,
			model: options.agentContract.model,
			prompt: resolverPrompt(request),
			canUseTool: composeCanUseTools(
				createWorkflowAgentGuards(),
				createMergeConflictResolverToolGuard(request),
			),
			askOwnerSource: `merge-conflict-resolver:${options.workflowName}/${options.runId}`,
		});
		const response = await options.runAgentHarness(
			harness,
			{
				...resolved.options,
				cwd: request.workspaceDir,
				systemPrompt: SYSTEM_PROMPT,
			},
			{
				signal: options.signal,
				workspaceKey: request.workspaceDir,
				writer: { write: () => true },
			},
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
