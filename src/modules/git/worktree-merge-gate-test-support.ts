import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { createAutomationWorktree } from "./worktree-lifecycle.js";

const repos: string[] = [];

export function git(cwd: string, args: string[]): string {
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

export function initRepo(label: string): string {
	const dir = mkdtempSync(join(tmpdir(), `kota-worktree-merge-${label}-`));
	repos.push(dir);
	git(dir, ["init", "--quiet", "--initial-branch=main"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "Test"]);
	writeFileSync(join(dir, ".gitignore"), ".kota/\n.worktrees/\n", "utf8");
	writeFileSync(join(dir, "README.md"), "# Fixture\n", "utf8");
	git(dir, ["add", ".gitignore", "README.md"]);
	git(dir, ["commit", "--quiet", "-m", "initial"]);
	return dir;
}

export function createFixtureWorktree(repo: string, runId = "run-1") {
	return createAutomationWorktree({
		projectDir: repo,
		taskId: "task-merge-gate",
		runId,
		workflowId: "builder",
		owner: "test-owner",
	});
}

export function commitFile(
	repo: string,
	path: string,
	content: string,
	message: string,
): void {
	writeFileSync(join(repo, path), content, "utf8");
	git(repo, ["add", path]);
	git(repo, ["commit", "--quiet", "-m", message]);
}

export function cleanupMergeGateFixtures(): void {
	for (const repo of repos.splice(0)) {
		rmSync(repo, { recursive: true, force: true });
	}
}
