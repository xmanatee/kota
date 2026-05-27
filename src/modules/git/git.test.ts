import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runGit } from "./git.js";

// Create a temporary git repo for testing
let testDir: string;
const origCwd = process.cwd();

function gitExec(args: string, cwd?: string): string {
	return execSync(`git ${args}`, {
		cwd: cwd ?? testDir,
		encoding: "utf-8",
		env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@test.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@test.com" },
	}).trim();
}

function createNestedBareRepoWithHookConfig(dir: string): {
	bareDir: string;
	markerPath: string;
} {
	const bareDir = join(dir, "nested.git");
	const hooksDir = join(dir, "malicious-hooks");
	const markerPath = join(dir, "hook-marker");
	mkdirSync(hooksDir, { recursive: true });
	gitExec(`init --bare "${bareDir}"`, dir);
	const hookPath = join(hooksDir, "pre-commit");
	writeFileSync(hookPath, `#!/bin/sh\necho hook-ran > ${JSON.stringify(markerPath)}\n`, "utf8");
	chmodSync(hookPath, 0o755);
	gitExec(`--git-dir "${bareDir}" config core.hooksPath "${hooksDir}"`, dir);
	return { bareDir, markerPath };
}

beforeAll(() => {
	testDir = join(tmpdir(), `kota-git-test-${Date.now()}`);
	mkdirSync(testDir, { recursive: true });
	gitExec("init", testDir);
	gitExec("config user.email test@test.com", testDir);
	gitExec("config user.name Test", testDir);
	writeFileSync(join(testDir, "README.md"), "# Test\n");
	gitExec("add .", testDir);
	gitExec('commit -m "Initial commit"', testDir);
	process.chdir(testDir);
});

afterAll(() => {
	process.chdir(origCwd);
	if (existsSync(testDir)) {
		rmSync(testDir, { recursive: true, force: true });
	}
});

describe("git tool", () => {
	describe("validation", () => {
		it("requires op parameter", async () => {
			const r = await runGit({});
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("op is required");
		});

		it("rejects unknown op", async () => {
			const r = await runGit({ op: "rebase" });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("unknown op");
			expect(r.content).toContain("status");
		});
	});

	describe("status", () => {
		it("shows clean working tree", async () => {
			const r = await runGit({ op: "status" });
			expect(r.is_error).toBeUndefined();
			expect(r.content).toContain("main");
		});

		it("shows modified files", async () => {
			writeFileSync(join(testDir, "README.md"), "# Updated\n");
			const r = await runGit({ op: "status" });
			expect(r.content).toContain("README.md");
			gitExec("checkout -- README.md");
		});

		it("rejects implicit nested bare repository discovery before hook-capable config can run", async () => {
			const { bareDir, markerPath } = createNestedBareRepoWithHookConfig(testDir);
			process.chdir(bareDir);
			try {
				const r = await runGit({ op: "status" });
				expect(r.is_error).toBe(true);
				expect(r.content).toContain("safe.bareRepository");
				expect(r.content).toContain("explicit");
				expect(existsSync(markerPath)).toBe(false);
			} finally {
				process.chdir(testDir);
			}
		});
	});

	describe("diff", () => {
		it("shows no changes when clean", async () => {
			const r = await runGit({ op: "diff" });
			expect(r.content).toBe("(no changes)");
		});

		it("shows diff for modified file", async () => {
			writeFileSync(join(testDir, "README.md"), "# Changed\n");
			const r = await runGit({ op: "diff" });
			expect(r.content).toContain("README.md");
			expect(r.content).toContain("-# Test");
			expect(r.content).toContain("+# Changed");
			gitExec("checkout -- README.md");
		});

		it("accepts path argument", async () => {
			writeFileSync(join(testDir, "a.txt"), "aaa\n");
			writeFileSync(join(testDir, "b.txt"), "bbb\n");
			gitExec("add .");
			const r = await runGit({ op: "diff", args: "--cached a.txt" });
			expect(r.content).toContain("a.txt");
			expect(r.content).not.toContain("b.txt");
			gitExec("reset HEAD a.txt b.txt");
			rmSync(join(testDir, "a.txt"));
			rmSync(join(testDir, "b.txt"));
		});
	});

	describe("log", () => {
		it("shows commit history", async () => {
			const r = await runGit({ op: "log" });
			expect(r.content).toContain("Initial commit");
		});

		it("accepts custom format", async () => {
			const r = await runGit({ op: "log", args: "--oneline -1" });
			expect(r.content).toContain("Initial commit");
			expect(r.content.split("\n")).toHaveLength(1);
		});
	});

	describe("show", () => {
		it("shows HEAD by default", async () => {
			const r = await runGit({ op: "show" });
			expect(r.content).toContain("Initial commit");
		});

		it("shows specific commit", async () => {
			const hash = gitExec("rev-parse HEAD");
			const r = await runGit({ op: "show", args: hash });
			expect(r.content).toContain("Initial commit");
		});

		it("errors on invalid ref", async () => {
			const r = await runGit({ op: "show", args: "nonexistent-ref-abc123" });
			expect(r.is_error).toBe(true);
		});
	});

	describe("add", () => {
		it("requires file paths", async () => {
			const r = await runGit({ op: "add" });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("file paths required");
		});

		it("stages files and shows status", async () => {
			writeFileSync(join(testDir, "new.txt"), "new file\n");
			const r = await runGit({ op: "add", args: "new.txt" });
			expect(r.is_error).toBeUndefined();
			expect(r.content).toContain("Staged");
			expect(r.content).toContain("new.txt");
			gitExec("reset HEAD new.txt");
			rmSync(join(testDir, "new.txt"));
		});
	});

	describe("commit", () => {
		it("requires commit message", async () => {
			const r = await runGit({ op: "commit" });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("commit message required");
		});

		it("creates a commit with staged changes", async () => {
			writeFileSync(join(testDir, "committed.txt"), "content\n");
			gitExec("add committed.txt");
			const r = await runGit({ op: "commit", args: "Add committed file" });
			expect(r.is_error).toBeUndefined();
			expect(r.content).toContain("committed");
			// Verify commit exists
			const log = gitExec("log --oneline -1");
			expect(log).toContain("Add committed file");
		});

		it("errors when nothing to commit", async () => {
			const r = await runGit({ op: "commit", args: "Empty commit attempt" });
			expect(r.is_error).toBe(true);
		});
	});

	describe("branch", () => {
		it("lists branches when no args", async () => {
			const r = await runGit({ op: "branch" });
			expect(r.content).toContain("main");
		});

		it("creates and switches to new branch", async () => {
			const r = await runGit({ op: "branch", args: "feature-test" });
			expect(r.is_error).toBeUndefined();
			const current = gitExec("rev-parse --abbrev-ref HEAD");
			expect(current).toBe("feature-test");
			gitExec("checkout main");
			gitExec("branch -d feature-test");
		});

		it("switches to existing branch", async () => {
			gitExec("branch existing-branch");
			const r = await runGit({ op: "branch", args: "checkout existing-branch" });
			expect(r.is_error).toBeUndefined();
			const current = gitExec("rev-parse --abbrev-ref HEAD");
			expect(current).toBe("existing-branch");
			gitExec("checkout main");
			gitExec("branch -d existing-branch");
		});

		it("deletes branch", async () => {
			gitExec("branch to-delete");
			const r = await runGit({ op: "branch", args: "-d to-delete" });
			expect(r.is_error).toBeUndefined();
			const branches = gitExec("branch --list to-delete");
			expect(branches).toBe("");
		});

		it("blocks deletion of protected branches", async () => {
			const r = await runGit({ op: "branch", args: "-d main" });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("protected branch");
		});

		it("blocks force-deletion of protected branches", async () => {
			const r = await runGit({ op: "branch", args: "-D master" });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("protected branch");
		});
	});

	describe("push safety", () => {
		// Push operations are tested for safety guardrails without a remote
		it("blocks force-push to main", async () => {
			const r = await runGit({ op: "push", args: "--force" });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("force-push");
			expect(r.content).toContain("not allowed");
		});

		it("blocks -f flag to main", async () => {
			const r = await runGit({ op: "push", args: "-f" });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("force-push");
		});

		it("allows force-with-lease (error from no remote, not from guardrail)", async () => {
			const r = await runGit({ op: "push", args: "--force-with-lease" });
			// Should fail from no remote, NOT from our guardrail
			expect(r.content).not.toContain("not allowed");
		});
	});

	describe("diff truncation", () => {
		it("truncates very large diffs", async () => {
			// Generate a large file to produce a big diff
			const bigContent = Array.from({ length: 2000 }, (_, i) => `line ${i}: ${"x".repeat(50)}`).join("\n");
			writeFileSync(join(testDir, "big.txt"), bigContent);
			const r = await runGit({ op: "diff" });
			if (r.content.length > 15000) {
				expect(r.content).toContain("truncated");
			}
			rmSync(join(testDir, "big.txt"));
		});
	});
});
