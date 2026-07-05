import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type {
	AutomationWorktreeMetadata,
	AutomationWorktreeSelector,
	WorktreeDirtyState,
	WorktreeListEntry,
	WorktreePushState,
} from "./worktree-lifecycle-types.js";

export const DEFAULT_WORKTREE_ROOT = ".worktrees";
const METADATA_DIR = join(".kota", "worktrees");
const DEFAULT_INCLUDE_FILE = ".worktreeinclude";

type AutomationWorktreeRuntimeResources = NonNullable<AutomationWorktreeMetadata["runtimeResources"]>;
type AutomationWorktreePortRange = NonNullable<AutomationWorktreeRuntimeResources["ports"]>;

export type GitJsonValue = string | number | boolean | null | GitJsonValue[] | GitJsonObject;
export type GitJsonObject = { [key: string]: GitJsonValue | undefined };

export function readGitJsonFile(path: string): GitJsonValue {
	return JSON.parse(readFileSync(path, "utf8")) as GitJsonValue;
}

export function isGitJsonObject(value: GitJsonValue | undefined): value is GitJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		env: withProtectedGitBareRepositoryEnv(),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function gitOptional(cwd: string, args: string[]): string | null {
	const result = spawnSync("git", args, {
		cwd,
		env: withProtectedGitBareRepositoryEnv(),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0) return null;
	return result.stdout.trim();
}

function gitStatus(cwd: string, args: string[]): number {
	const result = spawnSync("git", args, {
		cwd,
		env: withProtectedGitBareRepositoryEnv(),
		stdio: "ignore",
	});
	return result.status ?? 1;
}

function safeSegment(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

export function metadataPath(projectDir: string, taskId: string, runId: string): string {
	return join(projectDir, METADATA_DIR, `${safeSegment(taskId)}-${safeSegment(runId)}.json`);
}

export function metadataDir(projectDir: string): string {
	return join(projectDir, METADATA_DIR);
}

export function writeMetadata(projectDir: string, metadata: AutomationWorktreeMetadata): void {
	const path = metadataPath(projectDir, metadata.taskId, metadata.runId);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

export function readMetadata(selector: AutomationWorktreeSelector): AutomationWorktreeMetadata {
	return readAutomationWorktreeMetadataPath(metadataPath(selector.projectDir, selector.taskId, selector.runId));
}

export function readAutomationWorktreeMetadataPath(path: string): AutomationWorktreeMetadata {
	const parsed = readGitJsonFile(path);
	assertAutomationWorktreeMetadata(path, parsed);
	return parsed;
}

function assertAutomationWorktreeMetadata(
	path: string,
	value: GitJsonValue | AutomationWorktreeMetadata,
): asserts value is AutomationWorktreeMetadata {
	if (!isGitJsonObject(value)) throw new Error(`Invalid worktree metadata at ${path}: expected object`);
	const requiredStrings = [
		"taskId",
		"runId",
		"workflowId",
		"owner",
		"workspaceDir",
		"branch",
		"baseCommit",
		"createdAt",
		"updatedAt",
	] as const;
	if (value.schemaVersion !== 1) throw new Error(`Invalid worktree metadata at ${path}: schemaVersion must be 1`);
	for (const key of requiredStrings) {
		if (typeof value[key] !== "string") throw new Error(`Invalid worktree metadata at ${path}: ${key} must be a string`);
	}
	if (!["active", "pending-merge", "merged", "removed"].includes(String(value.state))) {
		throw new Error(`Invalid worktree metadata at ${path}: unsupported state ${String(value.state)}`);
	}
	if (!Array.isArray(value.copiedSetupFiles) || value.copiedSetupFiles.some((item) => typeof item !== "string")) {
		throw new Error(`Invalid worktree metadata at ${path}: copiedSetupFiles must be a string array`);
	}
	if (value.runtimeResources !== undefined) assertRuntimeResources(path, value.runtimeResources);
	if (value.lastCleanupBlockers !== undefined && !isStringArray(value.lastCleanupBlockers)) {
		throw new Error(`Invalid worktree metadata at ${path}: lastCleanupBlockers must be a string array`);
	}
	for (const key of ["stateReason", "removedAt", "mergedAt", "mergedCommit"] as const) {
		if (value[key] !== undefined && typeof value[key] !== "string") {
			throw new Error(`Invalid worktree metadata at ${path}: ${key} must be a string`);
		}
	}
}

function assertRuntimeResources(
	path: string,
	value: GitJsonValue | AutomationWorktreeMetadata["runtimeResources"],
): asserts value is AutomationWorktreeRuntimeResources {
	if (!isGitJsonObject(value)) throw new Error(`Invalid worktree metadata at ${path}: runtimeResources must be an object`);
	for (const key of ["profileId", "agentRunDir"] as const) {
		if (typeof value[key] !== "string") {
			throw new Error(`Invalid worktree metadata at ${path}: runtimeResources.${key} must be a string`);
		}
	}
	for (const key of ["tempRoot", "artifactRoot"] as const) {
		if (value[key] !== undefined && typeof value[key] !== "string") {
			throw new Error(`Invalid worktree metadata at ${path}: runtimeResources.${key} must be a string`);
		}
	}
	if (value.ports !== undefined) assertPortRange(path, value.ports);
}

function assertPortRange(
	path: string,
	value: GitJsonValue | AutomationWorktreePortRange,
): asserts value is AutomationWorktreePortRange {
	if (!isGitJsonObject(value)) throw new Error(`Invalid worktree metadata at ${path}: runtimeResources.ports must be an object`);
	if (typeof value.start !== "number" || typeof value.end !== "number") {
		throw new Error(`Invalid worktree metadata at ${path}: runtimeResources.ports must have numeric start and end`);
	}
}

function isStringArray(value: GitJsonValue | undefined): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function readDirtyState(repoDir: string): WorktreeDirtyState {
	const output = git(repoDir, ["status", "--porcelain=v1", "--untracked-files=all"]);
	const entries = output ? output.split("\n").map((line) => line.trimEnd()) : [];
	return {
		dirty: entries.length > 0,
		trackedDirty: entries.some((entry) => !entry.startsWith("??")),
		untracked: entries.some((entry) => entry.startsWith("??")),
		conflicted: entries.some((entry) => isConflictEntry(entry.slice(0, 2))),
		entries,
	};
}

function isConflictEntry(code: string): boolean {
	return code.includes("U") || code === "AA" || code === "DD";
}

export function readPushState(repoDir: string, baseCommit: string, headCommit: string): WorktreePushState {
	const hasLocalCommits = Boolean(headCommit && headCommit !== baseCommit);
	if (!hasLocalCommits) return emptyPushState();

	const upstream = gitOptional(repoDir, ["rev-parse", "--symbolic-full-name", "@{upstream}"]);
	const remoteUpstream = upstream?.startsWith("refs/remotes/") ? upstream.slice("refs/remotes/".length) : null;
	if (!remoteUpstream) {
		return { hasLocalCommits, remoteUpstream, aheadCount: null, unpushed: true };
	}

	const aheadOutput = gitOptional(repoDir, ["rev-list", "--count", `${upstream}..HEAD`]);
	const aheadCount = aheadOutput === null ? null : Number.parseInt(aheadOutput, 10);
	if (aheadCount === null || Number.isNaN(aheadCount)) {
		return { hasLocalCommits, remoteUpstream, aheadCount: null, unpushed: true };
	}
	return { hasLocalCommits, remoteUpstream, aheadCount, unpushed: aheadCount > 0 };
}

export function assertCanonicalCheckoutReady(projectDir: string): void {
	const dirty = readDirtyState(projectDir);
	if (dirty.trackedDirty || dirty.untracked) {
		throw new Error(`Cannot create automation worktree from dirty checkout: ${dirty.entries.join(", ")}`);
	}
}

export function uniqueWorkspaceDir(projectDir: string, root: string, taskId: string, runId: string): string {
	const base = join(projectDir, root, `${safeSegment(taskId)}-${safeSegment(runId)}`);
	for (let attempt = 1; attempt < 100; attempt += 1) {
		const candidate = attempt === 1 ? base : `${base}-${attempt}`;
		if (!existsSync(candidate)) return candidate;
	}
	throw new Error(`No available worktree path under ${join(projectDir, root)}`);
}

export function localBranchExists(projectDir: string, branch: string): boolean {
	return gitStatus(projectDir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]) === 0;
}

export function uniqueBranch(projectDir: string, taskId: string, runId: string): string {
	const base = `kota/task/${safeSegment(taskId)}/${safeSegment(runId)}`;
	for (let attempt = 1; attempt < 100; attempt += 1) {
		const candidate = attempt === 1 ? base : `${base}-${attempt}`;
		if (!localBranchExists(projectDir, candidate)) return candidate;
	}
	throw new Error(`No available automation branch for ${taskId}/${runId}`);
}

function validateIncludeEntry(projectDir: string, workspaceDir: string, entry: string): {
	source: string;
	target: string;
	relativePath: string;
} {
	if (isAbsolute(entry)) throw new Error(`Worktree include path must be relative: ${entry}`);
	const relativePath = normalize(entry);
	if (relativePath === "." || relativePath.startsWith(`..${sep}`) || relativePath === "..") {
		throw new Error(`Worktree include path escapes the project: ${entry}`);
	}
	const source = resolve(projectDir, relativePath);
	const target = resolve(workspaceDir, relativePath);
	if (!isInside(projectDir, source) || !isInside(workspaceDir, target)) {
		throw new Error(`Worktree include path escapes its root: ${entry}`);
	}
	return { source, target, relativePath };
}

function isInside(root: string, child: string): boolean {
	const rel = relative(resolve(root), resolve(child));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isGitIgnored(projectDir: string, relativePath: string): boolean {
	return gitStatus(projectDir, ["check-ignore", "--quiet", "--", relativePath]) === 0;
}

function copySafePath(source: string, target: string): void {
	const stat = lstatSync(source);
	if (stat.isSymbolicLink()) throw new Error(`Refusing to copy symlink into worktree: ${source}`);
	if (stat.isDirectory()) {
		mkdirSync(target, { recursive: true });
		for (const child of readdirSync(source)) {
			copySafePath(join(source, child), join(target, child));
		}
		return;
	}
	if (!stat.isFile()) throw new Error(`Refusing to copy non-file setup path: ${source}`);
	mkdirSync(dirname(target), { recursive: true });
	copyFileSync(source, target);
}

export function prepareAutomationWorktree(
	projectDir: string,
	workspaceDir: string,
	includeFile = DEFAULT_INCLUDE_FILE,
): string[] {
	const manifestPath = join(projectDir, includeFile);
	if (!existsSync(manifestPath)) return [];
	const copied: string[] = [];
	for (const rawLine of readFileSync(manifestPath, "utf8").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const entry = validateIncludeEntry(projectDir, workspaceDir, line);
		if (!existsSync(entry.source)) throw new Error(`Worktree include path does not exist: ${line}`);
		if (!isGitIgnored(projectDir, entry.relativePath)) {
			throw new Error(`Worktree include path is not ignored by git: ${line}`);
		}
		copySafePath(entry.source, entry.target);
		copied.push(entry.relativePath);
	}
	return copied;
}

export function emptyDirtyState(): WorktreeDirtyState {
	return { dirty: false, trackedDirty: false, untracked: false, conflicted: false, entries: [] };
}

export function emptyPushState(): WorktreePushState {
	return { hasLocalCommits: false, remoteUpstream: null, aheadCount: 0, unpushed: false };
}

export function comparablePath(path: string): string {
	return existsSync(path) ? realpathSync(path) : resolve(path);
}

export function parseWorktreeList(projectDir: string): WorktreeListEntry[] {
	const output = git(projectDir, ["worktree", "list", "--porcelain"]);
	const entries: WorktreeListEntry[] = [];
	let current: WorktreeListEntry | null = null;
	const flush = () => {
		if (current) entries.push(current);
		current = null;
	};
	for (const line of output.split(/\r?\n/)) {
		if (!line) {
			flush();
			continue;
		}
		if (line.startsWith("worktree ")) {
			flush();
			current = { path: line.slice("worktree ".length), headCommit: "", branch: "", lock: { locked: false, reason: null } };
		} else if (current && line.startsWith("HEAD ")) {
			current.headCommit = line.slice("HEAD ".length);
		} else if (current && line.startsWith("branch ")) {
			current.branch = line.startsWith("branch refs/heads/") ? line.slice("branch refs/heads/".length) : line.slice("branch ".length);
		} else if (current && line.startsWith("locked")) {
			const reason = line.slice("locked".length).trim();
			current.lock = { locked: true, reason: reason || null };
		}
	}
	flush();
	return entries;
}
