import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { runProcessGroupCommandSync } from "#modules/execution/process-group-command.js";
import {
	markAutomationWorktreeMerged,
	markAutomationWorktreePendingMerge,
} from "./worktree-lifecycle.js";
import {
	git,
	metadataPath,
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
const DEFAULT_MERGE_GATE_VALIDATION_TIMEOUT_MS = 30 * 60 * 1000;

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

export function canonicalConflictDiff(
	workspaceDir: string,
	baseCommit: string,
	canonicalHeadCommit: string,
	conflicts: readonly MergeGateConflict[],
): string {
	const paths = conflicts.map((conflict) => conflict.path);
	if (paths.length === 0) return "(no textual conflict paths)";
	const result = runGit(workspaceDir, [
		"diff",
		"--no-ext-diff",
		"--no-color",
		baseCommit,
		canonicalHeadCommit,
		"--",
		...paths,
	]);
	if (!result.ok) {
		throw new Error(
			result.stderr || result.stdout || "could not render canonical conflict diff",
		);
	}
	return result.stdout || "(canonical side has no textual diff for the conflict paths)";
}

export function runValidation(
	workspaceDir: string,
	command: readonly string[] | undefined,
	timeoutMs = DEFAULT_MERGE_GATE_VALIDATION_TIMEOUT_MS,
): MergeGateValidation | null {
	if (!command || command.length === 0) return null;
	const [executable, ...args] = command;
	if (!executable) return null;
	const result = runProcessGroupCommandSync({
		command: executable,
		args,
		cwd: workspaceDir,
		env: withProtectedGitBareRepositoryEnv(),
		timeoutMs,
		outputLimit: TAIL_LIMIT,
	});
	return {
		command: [...command],
		exitCode: result.exitCode,
		stdoutTail: tail(result.stdout),
		stderrTail: tail(result.stderr),
		passed: result.exitCode === 0,
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
	if (!hasInProgressMerge(repoDir)) return;
	const result = runGit(repoDir, ["merge", "--abort"]);
	if (!result.ok) {
		throw new Error(result.stderr || result.stdout || "could not abort merge");
	}
}

type UnmergedIndexEntry = { path: string; stages: Set<number> };

function unmergedIndexEntries(workspaceDir: string): UnmergedIndexEntry[] {
	const result = runGit(workspaceDir, ["ls-files", "--unmerged", "-z"]);
	if (!result.ok) throw new Error(result.stderr || "could not inspect unmerged index entries");
	const entries = new Map<string, Set<number>>();
	for (const record of result.stdout.split("\0").filter(Boolean)) {
		const match = /^\d+ [0-9a-f]+ ([123])\t([\s\S]+)$/.exec(record);
		if (!match?.[1] || !match[2]) throw new Error("malformed unmerged index entry");
		const stages = entries.get(match[2]) ?? new Set<number>();
		stages.add(Number(match[1]));
		entries.set(match[2], stages);
	}
	return [...entries].map(([path, stages]) => ({ path, stages })).sort((a, b) =>
		a.path.localeCompare(b.path)
	);
}

function renameConflictPaths(workspaceDir: string): ReadonlySet<string> {
	const mergeHead = runGit(workspaceDir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
	if (!mergeHead.ok) return new Set();
	const base = runGit(workspaceDir, ["merge-base", "HEAD", mergeHead.stdout]);
	if (!base.ok) throw new Error(base.stderr || "could not establish merge conflict ancestry");
	const paths = new Set<string>();
	for (const side of ["HEAD", mergeHead.stdout]) {
		const diff = runGit(workspaceDir, [
			"diff", "--name-status", "--find-renames", "--diff-filter=R", "-z", `${base.stdout}..${side}`,
		]);
		if (!diff.ok) throw new Error(diff.stderr || "could not inspect merge-side renames");
		const tokens = diff.stdout.split("\0").filter(Boolean);
		for (let index = 0; index < tokens.length; index += 3) {
			if (!tokens[index]?.startsWith("R") || !tokens[index + 1] || !tokens[index + 2]) {
				throw new Error("malformed merge-side rename entry");
			}
			paths.add(tokens[index + 1]);
			paths.add(tokens[index + 2]);
		}
	}
	return paths;
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
	const renamedPaths = renameConflictPaths(workspaceDir);
	return unmergedIndexEntries(workspaceDir).map(({ path, stages }) => {
		if (renamedPaths.has(path)) {
			return { path, kind: "blocked-path", reason: "rename conflict requires explicit disposition evidence" };
		}
		const isModifyModify = stages.has(1) && stages.has(2) && stages.has(3);
		const isAddAdd = !stages.has(1) && stages.has(2) && stages.has(3);
		if (!isModifyModify && !isAddAdd) {
			return { path, kind: "blocked-path", reason: "delete/modify or structural conflict requires explicit disposition evidence" };
		}
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
	markAutomationWorktreePendingMerge(selector, reason);
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
	markAutomationWorktreeMerged(selector, input.mergeCommit);
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
