import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
	cleanupAutomationWorktree,
	createAutomationWorktree,
	inspectAutomationWorktree,
	lockAutomationWorktree,
	markAutomationWorktreeMerged,
	prepareAutomationWorktree,
	reconcileAutomationWorktrees,
	unlockAutomationWorktree,
	updateAutomationWorktreeState,
} from "./worktree-lifecycle.js";

const repos: string[] = [];

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		env: {
			...withProtectedGitBareRepositoryEnv(),
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function initRepo(label: string): string {
	const dir = mkdtempSync(join(tmpdir(), `kota-worktree-${label}-`));
	repos.push(dir);
	git(dir, ["init", "--quiet", "--initial-branch=main"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "Test"]);
	writeFileSync(join(dir, ".gitignore"), ".kota/\n.worktrees/\n.env.local\n.not-included\n", "utf8");
	writeFileSync(join(dir, "README.md"), "# Fixture\n", "utf8");
	git(dir, ["add", ".gitignore", "README.md"]);
	git(dir, ["commit", "--quiet", "-m", "initial"]);
	return dir;
}

function initRepoWithRemote(label: string): string {
	const repo = initRepo(label);
	const remote = mkdtempSync(join(tmpdir(), `kota-worktree-${label}-remote-`));
	repos.push(remote);
	git(remote, ["init", "--bare", "--quiet", "--initial-branch=main"]);
	git(repo, ["remote", "add", "origin", remote]);
	git(repo, ["push", "--quiet", "--set-upstream", "origin", "main"]);
	return repo;
}

function createFixtureWorktree(repo: string, runId = "run-1") {
	return createAutomationWorktree({
		projectDir: repo,
		taskId: "task-add-worktree-provider",
		runId,
		workflowId: "builder",
		owner: "test-owner",
	});
}

function writeWorkflowState(repo: string, activeRunIds: string[]): void {
	mkdirSync(join(repo, ".kota"), { recursive: true });
	writeFileSync(
		join(repo, ".kota", "workflow-state.json"),
		`${JSON.stringify({
			completedRuns: 0,
			pendingRuns: [],
			activeRuns: activeRunIds.map((runId) => ({ runId, workflow: "builder", startedAt: "2026-01-01T00:00:00.000Z" })),
			workflows: {},
		}, null, 2)}\n`,
		"utf8",
	);
}

function writeRunMetadata(repo: string, runId: string, status: string): void {
	const runDir = join(repo, ".kota", "runs", runId);
	mkdirSync(runDir, { recursive: true });
	writeFileSync(
		join(runDir, "metadata.json"),
		`${JSON.stringify({
			id: runId,
			workflow: "builder",
			definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
			trigger: { event: "test", payload: {} },
			startedAt: "2026-01-01T00:00:00.000Z",
			status,
			runDir: `.kota/runs/${runId}`,
			steps: [],
		}, null, 2)}\n`,
		"utf8",
	);
}

afterEach(() => {
	for (const repo of repos.splice(0)) {
		rmSync(repo, { recursive: true, force: true });
	}
});

describe("automation worktree lifecycle", () => {
	it("creates, inspects, locks, unlocks, and safely removes a worktree", () => {
		const repo = initRepo("happy");
		const created = createFixtureWorktree(repo);

		expect(created.exists).toBe(true);
		expect(existsSync(created.metadata.workspaceDir)).toBe(true);
		expect(created.branch).toBe("kota/task/task-add-worktree-provider/run-1");
		expect(created.baseCommit).toMatch(/^[a-f0-9]{40}$/);
		expect(created.headCommit).toBe(created.baseCommit);
		expect(created.push).toMatchObject({
			hasLocalCommits: false,
			remoteUpstream: null,
			aheadCount: 0,
			unpushed: false,
		});
		expect(created.metadata).toMatchObject({
			taskId: "task-add-worktree-provider",
			runId: "run-1",
			workflowId: "builder",
			owner: "test-owner",
			state: "active",
		});

		const locked = lockAutomationWorktree(
			{ projectDir: repo, taskId: created.metadata.taskId, runId: created.metadata.runId },
			"agent running",
		);
		expect(locked.lock).toEqual({ locked: true, reason: "agent running" });
		const blocked = cleanupAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(blocked.removed).toBe(false);
		expect(blocked.inspection.metadata.lastCleanupBlockers).toContain("stale worktree is locked: agent running");

		const unlocked = unlockAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(unlocked.lock.locked).toBe(false);

		const removed = cleanupAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(removed.removed).toBe(true);
		expect(removed.inspection.exists).toBe(false);
		expect(removed.inspection.metadata.state).toBe("removed");
		expect(existsSync(created.metadata.workspaceDir)).toBe(false);
		expect(git(repo, ["branch", "--list", created.metadata.branch])).toBe("");
		expect(git(repo, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
	});

	it("uses a unique branch and path when the deterministic branch already exists", () => {
		const repo = initRepo("collision");
		git(repo, ["branch", "kota/task/task-add-worktree-provider/run-1"]);

		const created = createFixtureWorktree(repo);

		expect(created.branch).toBe("kota/task/task-add-worktree-provider/run-1-2");
		expect(basename(created.metadata.workspaceDir)).toBe("task-add-worktree-provider-run-1");
		expect(git(repo, ["branch", "--list", "kota/task/task-add-worktree-provider/run-1-2"])).toContain(
			"kota/task/task-add-worktree-provider/run-1-2",
		);
	});

	it("copies only explicitly included ignored setup files from .worktreeinclude", () => {
		const repo = initRepo("include");
		writeFileSync(join(repo, ".worktreeinclude"), ".env.local\n# ignored comment\n", "utf8");
		writeFileSync(join(repo, ".env.local"), "TOKEN=local\n", "utf8");
		writeFileSync(join(repo, ".not-included"), "skip\n", "utf8");
		git(repo, ["add", ".worktreeinclude"]);
		git(repo, ["commit", "--quiet", "-m", "add worktree include"]);

		const created = createFixtureWorktree(repo);

		expect(created.metadata.copiedSetupFiles).toEqual([".env.local"]);
		expect(readFileSync(join(created.metadata.workspaceDir, ".env.local"), "utf8")).toBe("TOKEN=local\n");
		expect(existsSync(join(created.metadata.workspaceDir, ".not-included"))).toBe(false);
	});

	it("rejects .worktreeinclude entries that are not git-ignored", () => {
		const repo = initRepo("include-reject");
		writeFileSync(join(repo, ".worktreeinclude"), "README.md\n", "utf8");
		git(repo, ["add", ".worktreeinclude"]);
		git(repo, ["commit", "--quiet", "-m", "add bad include"]);
		const workspaceDir = join(repo, ".worktrees", "manual");
		mkdirSync(workspaceDir, { recursive: true });

		expect(() => prepareAutomationWorktree(repo, workspaceDir)).toThrow(
			"Worktree include path is not ignored by git: README.md",
		);
	});

	it("refuses cleanup with tracked dirt, untracked files, and unmerged branch commits", () => {
		const repo = initRepo("dirty");
		const created = createFixtureWorktree(repo);
		writeFileSync(join(created.metadata.workspaceDir, "README.md"), "# Changed\n", "utf8");
		writeFileSync(join(created.metadata.workspaceDir, "new.txt"), "new\n", "utf8");

		const dirty = cleanupAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(dirty.removed).toBe(false);
		expect(dirty.inspection.metadata.lastCleanupBlockers).toEqual(
			expect.arrayContaining([
				"worktree has uncommitted tracked changes",
				"worktree has untracked files",
			]),
		);

		git(created.metadata.workspaceDir, ["checkout", "--", "README.md"]);
		rmSync(join(created.metadata.workspaceDir, "new.txt"));
		writeFileSync(join(created.metadata.workspaceDir, "committed.txt"), "committed\n", "utf8");
		git(created.metadata.workspaceDir, ["add", "committed.txt"]);
		git(created.metadata.workspaceDir, ["commit", "--quiet", "-m", "workspace commit"]);

		const unmerged = cleanupAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(unmerged.removed).toBe(false);
		expect(unmerged.inspection.metadata.lastCleanupBlockers).toContain(
			"branch has commits that are not marked merged",
		);
	});

	it("refuses cleanup when merged metadata has unpushed branch commits", () => {
		const repo = initRepoWithRemote("unpushed");
		const created = createFixtureWorktree(repo);
		writeFileSync(join(created.metadata.workspaceDir, "committed.txt"), "committed\n", "utf8");
		git(created.metadata.workspaceDir, ["add", "committed.txt"]);
		git(created.metadata.workspaceDir, ["commit", "--quiet", "-m", "workspace commit"]);

		markAutomationWorktreeMerged(
			{ projectDir: repo, taskId: created.metadata.taskId, runId: created.metadata.runId },
			created.baseCommit,
		);
		const blocked = cleanupAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});

		expect(blocked.removed).toBe(false);
		expect(blocked.inspection.push).toMatchObject({
			hasLocalCommits: true,
			remoteUpstream: null,
			aheadCount: null,
			unpushed: true,
		});
		expect(blocked.inspection.metadata.lastCleanupBlockers).toContain("branch has unpushed commits");
		expect(existsSync(created.metadata.workspaceDir)).toBe(true);
	});

	it("allows cleanup after merge-gate state marks pushed branch work as merged", () => {
		const repo = initRepoWithRemote("merged");
		const created = createFixtureWorktree(repo);
		writeFileSync(join(created.metadata.workspaceDir, "committed.txt"), "committed\n", "utf8");
		git(created.metadata.workspaceDir, ["add", "committed.txt"]);
		git(created.metadata.workspaceDir, ["commit", "--quiet", "-m", "workspace commit"]);

		const before = inspectAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(before.cleanup.blockers).toContain("branch has commits that are not marked merged");
		expect(before.cleanup.blockers).toContain("branch has unpushed commits");

		git(created.metadata.workspaceDir, ["push", "--quiet", "--set-upstream", "origin", created.metadata.branch]);
		const pushed = inspectAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(pushed.push).toMatchObject({
			hasLocalCommits: true,
			remoteUpstream: `origin/${created.metadata.branch}`,
			aheadCount: 0,
			unpushed: false,
		});

		expect(() =>
			updateAutomationWorktreeState(
				{ projectDir: repo, taskId: created.metadata.taskId, runId: created.metadata.runId },
				"merged" as never,
				"merge gate accepted branch",
			),
		).toThrow("Use markAutomationWorktreeMerged");

		markAutomationWorktreeMerged(
			{ projectDir: repo, taskId: created.metadata.taskId, runId: created.metadata.runId },
			pushed.headCommit,
		);
		const removed = cleanupAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});

		expect(removed.removed).toBe(true);
		expect(removed.inspection.metadata.stateReason).toBe("merge gate accepted branch");
		expect(removed.inspection.metadata.removedAt).toBeTruthy();
	});

	it("reconciles a failed dirty stale worktree by unlocking and preserving blockers", () => {
		const repo = initRepo("reconcile-dirty-failed");
		const created = createFixtureWorktree(repo, "run-failed");
		lockAutomationWorktree(
			{ projectDir: repo, taskId: created.metadata.taskId, runId: created.metadata.runId },
			"builder agent running",
		);
		writeWorkflowState(repo, []);
		writeRunMetadata(repo, created.metadata.runId, "failed");
		writeFileSync(join(created.metadata.workspaceDir, "README.md"), "# Changed\n", "utf8");

		const result = reconcileAutomationWorktrees(repo);
		const item = result.items.find((candidate) => candidate.runId === created.metadata.runId);
		const after = inspectAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});

		expect(item).toMatchObject({
			action: "unlocked-preserved",
			unlocked: true,
			removed: false,
			dirtyState: "dirty",
		});
		expect(after.exists).toBe(true);
		expect(after.lock.locked).toBe(false);
		expect(after.metadata.lastCleanupBlockers).toContain("worktree has uncommitted tracked changes");
	});

	it("reconciles a clean interrupted stale worktree by unlocking and removing it", () => {
		const repo = initRepo("reconcile-clean-interrupted");
		const created = createFixtureWorktree(repo, "run-interrupted");
		lockAutomationWorktree(
			{ projectDir: repo, taskId: created.metadata.taskId, runId: created.metadata.runId },
			"builder agent running",
		);
		writeWorkflowState(repo, []);
		writeRunMetadata(repo, created.metadata.runId, "interrupted");

		const result = reconcileAutomationWorktrees(repo);
		const item = result.items.find((candidate) => candidate.runId === created.metadata.runId);
		const after = inspectAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});

		expect(item).toMatchObject({
			action: "unlocked-removed",
			unlocked: true,
			removed: true,
			dirtyState: "clean",
		});
		expect(after.exists).toBe(false);
		expect(after.metadata.state).toBe("removed");
	});

	it("leaves an active builder worktree locked and untouched", () => {
		const repo = initRepo("reconcile-active");
		const created = createFixtureWorktree(repo, "run-active");
		lockAutomationWorktree(
			{ projectDir: repo, taskId: created.metadata.taskId, runId: created.metadata.runId },
			"builder agent running",
		);
		writeWorkflowState(repo, [created.metadata.runId]);
		writeRunMetadata(repo, created.metadata.runId, "running");

		const result = reconcileAutomationWorktrees(repo);
		const item = result.items.find((candidate) => candidate.runId === created.metadata.runId);
		const after = inspectAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});

		expect(item).toMatchObject({
			action: "active",
			unlocked: false,
			removed: false,
		});
		expect(after.exists).toBe(true);
		expect(after.lock).toEqual({ locked: true, reason: "builder agent running" });
	});
});
