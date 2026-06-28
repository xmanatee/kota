import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
	git,
	metadataPath,
	readDirtyState,
	readMetadata,
	writeMetadata,
} from "./worktree-lifecycle-support.js";
import type { AutomationWorktreeSelector } from "./worktree-lifecycle-types.js";
import type {
	MergeGateConflict,
	MergeGateResult,
	MergeGateStatus,
	MergeGateValidation,
} from "./worktree-merge-gate-types.js";

export const DEFAULT_MAX_RESOLUTION_ATTEMPTS = 2;
const TAIL_LIMIT = 6000;

function tail(value: string): string {
	return value.length <= TAIL_LIMIT ? value : value.slice(value.length - TAIL_LIMIT);
}

function mergeGateArtifactPath(selector: AutomationWorktreeSelector): string {
	const metadata = metadataPath(selector.projectDir, selector.taskId, selector.runId);
	return metadata.replace(/\.json$/, ".merge-gate.json");
}

export function writeMergeGateArtifact(result: MergeGateResult): MergeGateResult {
	mkdirSync(dirname(result.artifactPath), { recursive: true });
	writeFileSync(result.artifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
	return result;
}

function updatePendingState(selector: AutomationWorktreeSelector, reason: string): void {
	const metadata = readMetadata(selector);
	writeMetadata(selector.projectDir, {
		...metadata,
		state: "pending-merge",
		stateReason: reason,
		updatedAt: new Date().toISOString(),
	});
}

function updateMergedState(selector: AutomationWorktreeSelector, mergeCommit: string): void {
	const now = new Date().toISOString();
	const metadata = readMetadata(selector);
	writeMetadata(selector.projectDir, {
		...metadata,
		state: "merged",
		stateReason: "merge gate accepted branch",
		mergedAt: now,
		mergedCommit: mergeCommit,
		updatedAt: now,
		lastCleanupBlockers: [],
	});
}

export function runGit(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
	const result = spawnSync("git", args, {
		cwd,
		env: withProtectedGitBareRepositoryEnv(),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return {
		ok: result.status === 0,
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
	};
}

export function runValidation(workspaceDir: string, command: readonly string[] | undefined): MergeGateValidation | null {
	if (!command || command.length === 0) return null;
	const [executable, ...args] = command;
	if (!executable) return null;
	const result = spawnSync(executable, args, {
		cwd: workspaceDir,
		env: withProtectedGitBareRepositoryEnv(),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return {
		command: [...command],
		exitCode: result.status,
		stdoutTail: tail(result.stdout),
		stderrTail: tail(result.stderr),
		passed: result.status === 0,
	};
}

export function currentHead(repoDir: string): string {
	return git(repoDir, ["rev-parse", "HEAD"]);
}

export function isAncestor(repoDir: string, ancestor: string, descendant: string): boolean {
	return runGit(repoDir, ["merge-base", "--is-ancestor", ancestor, descendant]).ok;
}

function hasInProgressMerge(repoDir: string): boolean {
	return existsSync(join(repoDir, ".git", "MERGE_HEAD")) || runGit(repoDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok;
}

export function abortMerge(repoDir: string): void {
	if (hasInProgressMerge(repoDir)) runGit(repoDir, ["merge", "--abort"]);
}

function conflictPaths(workspaceDir: string): string[] {
	const dirty = readDirtyState(workspaceDir);
	const paths = new Set<string>();
	for (const entry of dirty.entries) {
		if (entry.length < 4) continue;
		const code = entry.slice(0, 2);
		if (!code.includes("U") && code !== "AA" && code !== "DD") continue;
		paths.add(entry.slice(3).trim());
	}
	return [...paths].sort();
}

function isGeneratedOrBlockedPath(path: string): boolean {
	return (
		path.startsWith("dist/") ||
		path.startsWith("build/") ||
		path.includes("/generated/") ||
		path.startsWith("src/modules/model-clients/generated/") ||
		path === "pnpm-lock.yaml" ||
		path.endsWith(".lock")
	);
}

function looksBinaryPath(path: string): boolean {
	return /\.(avif|bin|bmp|gif|ico|jpeg|jpg|mov|mp4|pdf|png|webp|zip)$/i.test(path);
}

function isBinaryConflict(workspaceDir: string, path: string): boolean {
	if (looksBinaryPath(path)) return true;
	const result = runGit(workspaceDir, ["diff", "--numstat", "--", path]);
	return result.stdout.split(/\r?\n/).some((line) => line.startsWith("-\t-"));
}

function hasConflictMarkers(workspaceDir: string, path: string): boolean {
	const absolutePath = join(workspaceDir, path);
	if (!existsSync(absolutePath)) return false;
	const content = readFileSync(absolutePath, "utf8");
	return content
		.split(/\r?\n/)
		.some(
			(line) =>
				/^<{7}(?:\s|$)/.test(line) ||
				/^\|{7}(?:\s|$)/.test(line) ||
				/^={7}$/.test(line) ||
				/^>{7}(?:\s|$)/.test(line),
		);
}

export function conflictMarkerConflicts(
	workspaceDir: string,
	conflicts: readonly MergeGateConflict[],
): MergeGateConflict[] {
	return conflicts
		.filter((conflict) => conflict.kind === "text" && hasConflictMarkers(workspaceDir, conflict.path))
		.map((conflict) => ({
			path: conflict.path,
			kind: "text" as const,
			reason: "unresolved conflict markers remain after resolver attempt",
		}));
}

export function classifyConflicts(workspaceDir: string): MergeGateConflict[] {
	return conflictPaths(workspaceDir).map((path) => {
		if (isGeneratedOrBlockedPath(path)) {
			return { path, kind: "blocked-path", reason: "generated or high-risk path requires manual merge" };
		}
		if (isBinaryConflict(workspaceDir, path)) {
			return { path, kind: "binary", reason: "binary conflict requires manual merge" };
		}
		return { path, kind: "text", reason: "text conflict can be resolved by a bounded resolver" };
	});
}

function resultFor(
	input: {
		selector: AutomationWorktreeSelector;
		status: MergeGateStatus;
		branch: string;
		baseCommit: string;
		canonicalHeadCommit: string;
		headCommit: string;
		mergeCommit: string | null;
		reason: string | null;
		conflicts: MergeGateConflict[];
		resolutionAttempts: number;
		validation: MergeGateValidation | null;
		metrics?: MergeGateResult["metrics"];
	},
): MergeGateResult {
	return {
		status: input.status,
		taskId: input.selector.taskId,
		runId: input.selector.runId,
		branch: input.branch,
		baseCommit: input.baseCommit,
		canonicalHeadCommit: input.canonicalHeadCommit,
		headCommit: input.headCommit,
		mergeCommit: input.mergeCommit,
		reason: input.reason,
		conflicts: input.conflicts,
		resolutionAttempts: input.resolutionAttempts,
		validation: input.validation,
		metrics: input.metrics ?? {
			waitMs: 0,
			mergeDurationMs: 0,
			conflictCount: input.conflicts.length,
			resolverAttempts: input.resolutionAttempts,
			validationFailures: input.validation && !input.validation.passed ? 1 : 0,
			serializedByLock: false,
		},
		artifactPath: mergeGateArtifactPath(input.selector),
	};
}

export function pending(
	selector: AutomationWorktreeSelector,
	input: Omit<Parameters<typeof resultFor>[0], "selector" | "status" | "mergeCommit"> & {
		status?: Exclude<MergeGateStatus, "merged">;
	},
): MergeGateResult {
	const status = input.status ?? "pending-conflict";
	const reason = input.reason ?? "merge gate blocked";
	updatePendingState(selector, reason);
	return writeMergeGateArtifact(
		resultFor({
			...input,
			selector,
			status,
			mergeCommit: null,
			reason,
		}),
	);
}

export function merged(
	selector: AutomationWorktreeSelector,
	input: Omit<Parameters<typeof resultFor>[0], "selector" | "status" | "reason" | "conflicts" | "mergeCommit"> & {
		mergeCommit: string;
	},
): MergeGateResult {
	updateMergedState(selector, input.mergeCommit);
	return writeMergeGateArtifact(
		resultFor({
			...input,
			selector,
			status: "merged",
			reason: null,
			conflicts: [],
			mergeCommit: input.mergeCommit,
		}),
	);
}
