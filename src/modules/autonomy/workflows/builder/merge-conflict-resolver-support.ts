import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
	AgentCanUseTool,
	AgentPermissionResult,
} from "#core/agent-harness/index.js";
import type {
	MergeGateConflict,
	MergeGateResolverRequest,
	MergeGateValidation,
} from "#modules/git/worktree-merge-gate.js";
import type { showTask } from "#modules/repo-tasks/repo-tasks-operations.js";
import type { MergeConflictResolutionJudgment } from "./merge-conflict-resolution-review.js";
import type { MergeConflictResolverOptions } from "./merge-conflict-resolver.js";

const ARTIFACT_TAIL_LIMIT = 2_000;
export const MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS = [
	"Read",
	"Edit",
	"MultiEdit",
	"file_read",
	"file_edit",
	"scaffold_search_read",
	"scaffold_edit",
] as const;
const ALLOWED_TOOL_SET = new Set<string>(MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS);
const TOOL_DENIAL =
	"Merge-conflict resolver may only use file read/edit tools on listed textual conflict files.";
type ToolInput = Parameters<AgentCanUseTool>[1];
type TaskContract = Extract<ReturnType<typeof showTask>, { found: true }>;

export const MERGE_CONFLICT_RESOLVER_SYSTEM_PROMPT = `You are KOTA's bounded merge-conflict resolver.

Resolve only the textual Git conflict files listed by the merge gate. Preserve the intent of both sides when possible, remove conflict markers, and do not stage, commit, merge, rebase, delete worktrees, edit generated files, or touch unrelated paths. The merge gate will stage allowed paths and rerun validation; your self-report is not accepted as proof.`;

function tail(value: string): string {
	return value.length <= ARTIFACT_TAIL_LIMIT
		? value
		: value.slice(value.length - ARTIFACT_TAIL_LIMIT);
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

export function conflictPathSet(request: MergeGateResolverRequest): Set<string> {
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

function stringInput(input: ToolInput, key: string): string | null {
	const value = input[key];
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArrayInput(input: ToolInput, key: string): string[] {
	const value = input[key];
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function toolTargetPaths(toolName: string, input: ToolInput): string[] {
	if (toolName === "scaffold_search_read") return stringArrayInput(input, "read_paths");
	const directPath = stringInput(input, "file_path") ?? stringInput(input, "path");
	return directPath ? [directPath] : [];
}

function deny(message = TOOL_DENIAL): AgentPermissionResult {
	return { behavior: "deny", message, decisionAttribution: "operator-deny" };
}

export function createMergeConflictResolverToolGuard(
	request: MergeGateResolverRequest,
): AgentCanUseTool {
	const allowedConflictPaths = conflictPathSet(request);
	return async (toolName, input): Promise<AgentPermissionResult> => {
		if (!ALLOWED_TOOL_SET.has(toolName)) return deny();
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

export function mergeConflictResolverPrompt(
	request: MergeGateResolverRequest,
	task: TaskContract,
): string {
	return [
		"## Task",
		"Resolve the listed textual merge conflicts in the current worktree.",
		"",
		`Claimed task: ${request.taskId} (${task.state})`,
		`Workspace: ${request.workspaceDir}`,
		`Branch: ${request.branch}`,
		`Branch head: ${request.headCommit}`,
		`Original base: ${request.baseCommit}`,
		`Canonical head: ${request.canonicalHeadCommit}`,
		`Attempt: ${request.attempt}`,
		"",
		"## Claimed Task Contract",
		task.content.trim(),
		"",
		"## Allowed Conflict Files",
		formatConflicts(request.conflicts),
		"",
		"## Canonical Diff For Conflict Files",
		request.canonicalDiff,
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

export type MergeConflictResolverAttempt = {
	resolved: boolean;
	summary: string;
	isError: boolean;
	subtype?: string;
	taskState?: string;
	transcript?: string;
	reviewTranscript?: string;
	resolvedDiff?: string;
	taskScopeJudgment?: MergeConflictResolutionJudgment;
};

export function appendMergeConflictResolverAttempt(
	options: MergeConflictResolverOptions,
	request: MergeGateResolverRequest,
	result: MergeConflictResolverAttempt,
): void {
	const artifactPath = join(options.runDirPath, "merge-conflict-resolver-attempts.jsonl");
	mkdirSync(dirname(artifactPath), { recursive: true });
	appendFileSync(
		artifactPath,
		`${JSON.stringify({
			workflow: options.workflowName,
			runId: options.runId,
			taskId: request.taskId,
			branch: request.branch,
			baseCommit: request.baseCommit,
			canonicalHeadCommit: request.canonicalHeadCommit,
			headCommit: request.headCommit,
			attempt: request.attempt,
			conflicts: request.conflicts,
			writeScope: [...conflictPathSet(request)],
			canonicalDiffBytes: Buffer.byteLength(request.canonicalDiff, "utf8"),
			canonicalDiffTail: tail(request.canonicalDiff),
			resolved: result.resolved,
			summary: tail(result.summary),
			isError: result.isError,
			...(result.subtype !== undefined ? { subtype: result.subtype } : {}),
			...(result.taskState !== undefined ? { taskState: result.taskState } : {}),
			...(result.transcript !== undefined ? { transcriptTail: tail(result.transcript) } : {}),
			...(result.reviewTranscript !== undefined
				? { reviewTranscriptTail: tail(result.reviewTranscript) }
				: {}),
			...(result.resolvedDiff !== undefined
				? { resolvedDiffTail: tail(result.resolvedDiff) }
				: {}),
			...(result.taskScopeJudgment !== undefined
				? { taskScopeJudgment: result.taskScopeJudgment }
				: {}),
			recordedAt: new Date().toISOString(),
		})}\n`,
		"utf8",
	);
}
