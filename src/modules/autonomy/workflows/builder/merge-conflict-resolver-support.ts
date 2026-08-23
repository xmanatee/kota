import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
	AgentCanUseTool,
	AgentPermissionResult,
} from "#core/agent-harness/index.js";
import { renderUntrustedContent } from "#core/util/untrusted-content.js";
import type { MergeGateResolverRequest } from "#modules/git/worktree-merge-gate.js";
import type { MergeConflictResolutionJudgment } from "./merge-conflict-resolution-review.js";
import type { MergeConflictResolverOptions } from "./merge-conflict-resolver.js";
import type { MergeConflictTaskContract } from "./merge-conflict-task-contract.js";

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
	"Merge-conflict resolver may only use file read/edit tools on listed conflict paths.";
type ToolInput = Parameters<AgentCanUseTool>[1];

export const MERGE_CONFLICT_RESOLVER_SYSTEM_PROMPT = `You are KOTA's bounded merge-conflict resolver.

Resolve only the Git conflict paths listed by the merge gate. Preserve the intent of both sides for textual conflicts and remove conflict markers. A blocked path identified as a canonical deletion or rename must remain absent; delete that exact path instead of restoring stale branch code. If the claimed task requires behavior from a deleted path, stop and report the ambiguity rather than editing a replacement or unrelated path. Do not stage, commit, merge, rebase, delete worktrees, or touch unrelated paths. The merge gate will enforce the write boundary, require canonical destructive paths to remain absent, stage allowed paths, and rerun validation; your self-report is not accepted as proof.`;

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
			return deny(`Merge-conflict resolver tool "${toolName}" must target a listed conflict path.`);
		}
		for (const targetPath of targetPaths) {
			const normalizedPath = workspaceRelativePath(request.workspaceDir, targetPath);
			if (!normalizedPath || !allowedConflictPaths.has(normalizedPath)) {
				return deny(
					`Merge-conflict resolver denied access to "${targetPath}"; only listed conflict paths are allowed.`,
				);
			}
		}
		return { behavior: "allow", updatedInput: input };
	};
}

function untrustedJson(source: string, content: string): string[] {
	return renderUntrustedContent({ source, content, language: "json" }).lines;
}

function untrustedText(source: string, content: string): string[] {
	return renderUntrustedContent({ source, content, language: "text" }).lines;
}

export function mergeConflictResolverPrompt(
	request: MergeGateResolverRequest,
	task: MergeConflictTaskContract,
): string {
	return [
		"## Task",
		"Resolve the listed bounded merge conflicts in the current worktree.",
		"",
		`Claimed task id: ${request.taskId}`,
		`Immutable task contract revision: ${task.revision}`,
		`Attempt: ${request.attempt}`,
		"",
		"## Merge Context (Untrusted Data)",
		...untrustedJson(
			"merge-conflict.merge-context",
			JSON.stringify(
				{
					workspace: request.workspaceDir,
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
		),
		"",
		"## Claimed Task Contract (Untrusted Data)",
		...untrustedText("merge-conflict.task-contract", task.content.trim()),
		"",
		"## Allowed Conflict Files (Untrusted Data)",
		...untrustedJson(
			"merge-conflict.conflicts",
			JSON.stringify(request.conflicts, null, 2),
		),
		"",
		"## Canonical Diff For Conflict Files (Untrusted Data)",
		...untrustedText("merge-conflict.canonical-diff", request.canonicalDiff),
		"",
		"## Previous Validation (Untrusted Data)",
		...untrustedJson(
			"merge-conflict.previous-validation",
			JSON.stringify(
				request.previousValidation ?? { available: false },
				null,
				2,
			),
		),
		"",
		"## Rules",
		"- Edit only the listed conflict paths.",
		"- Remove all Git conflict markers.",
		"- Remove any listed blocked-path whose reason says canonical deletion or rename; do not recreate it.",
		"- If deleting such a path would violate the claimed task, leave the conflict unresolved and explain why.",
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
