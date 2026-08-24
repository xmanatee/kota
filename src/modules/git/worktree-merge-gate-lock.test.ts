import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { createAutomationWorktree } from "./worktree-lifecycle.js";
import { mergeAutomationWorktree } from "./worktree-merge-gate.js";
import {
	acquireMergeGateLock,
	releaseMergeGateLock,
} from "./worktree-merge-gate-lock.js";

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
		const worktrees = ["a", "b", "c", "d"].map((suffix) =>
			createAutomationWorktree({
				projectDir: repo,
				taskId: `task-${suffix}`,
				runId: `run-${suffix}`,
				workflowId: "builder",
				owner: "test-owner",
			}),
		);
		for (const [index, worktree] of worktrees.entries()) {
			const suffix = String.fromCharCode("a".charCodeAt(0) + index);
			commitFile(
				worktree.metadata.workspaceDir,
				`${suffix}.txt`,
				`${suffix}\n`,
				`add ${suffix}`,
			);
		}
		const slowValidation = [
			"node",
			"-e",
			"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80); process.exit(0)",
		];

		const results = await Promise.all(
			worktrees.map((worktree) =>
				mergeAutomationWorktree({
					projectDir: repo,
					taskId: worktree.metadata.taskId,
					runId: worktree.metadata.runId,
					validationCommand: slowValidation,
				}),
			),
		);

		expect(results.every((result) => result.status === "merged")).toBe(true);
		for (const suffix of ["a", "b", "c", "d"]) {
			expect(readFileSync(join(repo, `${suffix}.txt`), "utf8")).toBe(`${suffix}\n`);
		}
		expect(Math.max(...results.map((result) => result.metrics.waitMs))).toBeGreaterThan(0);
		expect(results.every((result) => result.metrics.serializedByLock)).toBe(true);
	});

	it("cancels a queued owner without converting contention into merge state", async () => {
		const repo = initRepo("cancel-waiter");
		const owner = await acquireMergeGateLock({
			projectDir: repo,
			taskId: "task-owner",
			runId: "run-owner",
		});
		const controller = new AbortController();
		const waiting = acquireMergeGateLock({
			projectDir: repo,
			taskId: "task-waiter",
			runId: "run-waiter",
			signal: controller.signal,
		});
		controller.abort(new Error("fixture cancelled"));

		await expect(waiting).rejects.toThrow("fixture cancelled");
		await releaseMergeGateLock(repo, owner.ownerId);
	});

	it("reclaims a lock whose owning process is gone", async () => {
		const repo = initRepo("stale-owner");
		const lockPath = join(repo, ".kota", "worktrees", "merge-gate.lock");
		execFileSync("mkdir", ["-p", lockPath]);
		writeFileSync(
			join(lockPath, "owner.json"),
			`${JSON.stringify({
				schemaVersion: 1,
				ownerId: "dead-owner",
				pid: 2_147_483_647,
				taskId: "task-dead",
				runId: "run-dead",
				acquiredAt: new Date().toISOString(),
			})}\n`,
			"utf8",
		);

		const owner = await acquireMergeGateLock({
			projectDir: repo,
			taskId: "task-live",
			runId: "run-live",
		});

		expect(owner.waitMs).toBeGreaterThanOrEqual(0);
		await releaseMergeGateLock(repo, owner.ownerId);
	});

	it("rejects release by a run that does not own the lock", async () => {
		const repo = initRepo("owner-token");
		const owner = await acquireMergeGateLock({
			projectDir: repo,
			taskId: "task-owner",
			runId: "run-owner",
		});

		await expect(releaseMergeGateLock(repo, "different-owner")).rejects.toThrow(
			"ownership changed",
		);
		await releaseMergeGateLock(repo, owner.ownerId);
	});

});
