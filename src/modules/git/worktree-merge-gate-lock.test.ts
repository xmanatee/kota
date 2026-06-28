import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { createAutomationWorktree } from "./worktree-lifecycle.js";
import { mergeAutomationWorktree } from "./worktree-merge-gate.js";

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
	const dir = mkdtempSync(join(tmpdir(), `kota-worktree-merge-lock-${label}-`));
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

function commitFile(repo: string, path: string, content: string, message: string): void {
	writeFileSync(join(repo, path), content, "utf8");
	git(repo, ["add", path]);
	git(repo, ["commit", "--quiet", "-m", message]);
}

afterEach(() => {
	for (const repo of repos.splice(0)) {
		rmSync(repo, { recursive: true, force: true });
	}
});

describe("automation worktree merge gate lock", () => {
	it("serializes concurrent disjoint merges through the merge gate lock", async () => {
		const repo = initRepo("parallel-clean");
		const first = createAutomationWorktree({
			projectDir: repo,
			taskId: "task-a",
			runId: "run-a",
			workflowId: "builder",
			owner: "test-owner",
		});
		const second = createAutomationWorktree({
			projectDir: repo,
			taskId: "task-b",
			runId: "run-b",
			workflowId: "builder",
			owner: "test-owner",
		});
		commitFile(first.metadata.workspaceDir, "a.txt", "a\n", "add a");
		commitFile(second.metadata.workspaceDir, "b.txt", "b\n", "add b");
		const slowValidation = [
			"node",
			"-e",
			"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80); process.exit(0)",
		];

		const [firstResult, secondResult] = await Promise.all([
			mergeAutomationWorktree({
				projectDir: repo,
				taskId: first.metadata.taskId,
				runId: first.metadata.runId,
				validationCommand: slowValidation,
			}),
			mergeAutomationWorktree({
				projectDir: repo,
				taskId: second.metadata.taskId,
				runId: second.metadata.runId,
				validationCommand: slowValidation,
			}),
		]);

		expect(firstResult.status).toBe("merged");
		expect(secondResult.status).toBe("merged");
		expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("a\n");
		expect(readFileSync(join(repo, "b.txt"), "utf8")).toBe("b\n");
		expect(Math.max(firstResult.metrics.waitMs, secondResult.metrics.waitMs)).toBeGreaterThan(0);
		expect(firstResult.metrics.serializedByLock).toBe(true);
		expect(secondResult.metrics.serializedByLock).toBe(true);
	});
});
