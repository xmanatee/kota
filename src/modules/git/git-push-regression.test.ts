import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGit } from "./git.js";

type PushFixture = {
	bareDir: string;
	localDir: string;
	rootDir: string;
	remoteMain: string;
};

function git(args: readonly string[], cwd: string): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_EMAIL: "test@test.com",
			GIT_AUTHOR_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@test.com",
			GIT_COMMITTER_NAME: "Test",
		},
	}).trim();
}

function createPushFixture(): PushFixture {
	const rootDir = mkdtempSync(join(tmpdir(), "kota-git-push-"));
	const bareDir = join(rootDir, "remote.git");
	const localDir = join(rootDir, "local");
	mkdirSync(localDir);
	git(["init", "--bare", bareDir], rootDir);
	git(["init", "-b", "main"], localDir);
	git(["config", "user.email", "test@test.com"], localDir);
	git(["config", "user.name", "Test"], localDir);
	writeFileSync(join(localDir, "README.md"), "# Initial\n");
	git(["add", "README.md"], localDir);
	git(["commit", "-m", "Initial commit"], localDir);
	git(["remote", "add", "origin", bareDir], localDir);
	git(["push", "origin", "main"], localDir);
	return {
		bareDir,
		localDir,
		rootDir,
		remoteMain: git(["--git-dir", bareDir, "rev-parse", "refs/heads/main"], rootDir),
	};
}

function remoteMain(fixture: PushFixture): string {
	return git(
		["--git-dir", fixture.bareDir, "rev-parse", "refs/heads/main"],
		fixture.rootDir,
	);
}

describe("git protected-branch push regression", () => {
	it("blocks a positive force refspec targeting a protected branch", async () => {
		const fixture = createPushFixture();
		try {
			writeFileSync(join(fixture.localDir, "README.md"), "# Rewritten\n");
			git(["add", "README.md"], fixture.localDir);
			git(["commit", "-m", "Rewrite main"], fixture.localDir);

			const result = await runGit(
				{ op: "push", args: "origin +HEAD:main" },
				{ cwd: fixture.localDir },
			);

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain("force-push");
			expect(remoteMain(fixture)).toBe(fixture.remoteMain);
		} finally {
			rmSync(fixture.rootDir, { recursive: true, force: true });
		}
	});

	it("blocks a positive force refspec when the remote uses --repo", async () => {
		const fixture = createPushFixture();
		try {
			git(["checkout", "-b", "feature"], fixture.localDir);
			writeFileSync(join(fixture.localDir, "feature.txt"), "feature\n");
			git(["add", "feature.txt"], fixture.localDir);
			git(["commit", "-m", "Feature commit"], fixture.localDir);

			const result = await runGit(
				{ op: "push", args: "--repo=origin +HEAD:main" },
				{ cwd: fixture.localDir },
			);

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain("force-push");
			expect(remoteMain(fixture)).toBe(fixture.remoteMain);
		} finally {
			rmSync(fixture.rootDir, { recursive: true, force: true });
		}
	});

	it("fails closed on an abbreviated --repo force refspec", async () => {
		const fixture = createPushFixture();
		try {
			git(["checkout", "-b", "feature"], fixture.localDir);
			writeFileSync(join(fixture.localDir, "feature.txt"), "feature\n");
			git(["add", "feature.txt"], fixture.localDir);
			git(["commit", "-m", "Feature commit"], fixture.localDir);

			const result = await runGit(
				{ op: "push", args: "--rep=origin +HEAD:main" },
				{ cwd: fixture.localDir },
			);

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain("unable to verify push safety");
			expect(remoteMain(fixture)).toBe(fixture.remoteMain);
		} finally {
			rmSync(fixture.rootDir, { recursive: true, force: true });
		}
	});

	it("blocks the current-branch shorthand when it resolves to protected main", async () => {
		const fixture = createPushFixture();
		try {
			writeFileSync(join(fixture.localDir, "README.md"), "# Updated\n");
			git(["add", "README.md"], fixture.localDir);
			git(["commit", "-m", "Update main"], fixture.localDir);

			const result = await runGit(
				{ op: "push", args: "--force origin @" },
				{ cwd: fixture.localDir },
			);

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain("force-push");
			expect(remoteMain(fixture)).toBe(fixture.remoteMain);
		} finally {
			rmSync(fixture.rootDir, { recursive: true, force: true });
		}
	});

	it("blocks an abbreviated protected branch ref", async () => {
		const fixture = createPushFixture();
		try {
			writeFileSync(join(fixture.localDir, "README.md"), "# Updated\n");
			git(["add", "README.md"], fixture.localDir);
			git(["commit", "-m", "Update main"], fixture.localDir);

			const result = await runGit(
				{ op: "push", args: "--force origin heads/main" },
				{ cwd: fixture.localDir },
			);

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain("force-push");
			expect(remoteMain(fixture)).toBe(fixture.remoteMain);
		} finally {
			rmSync(fixture.rootDir, { recursive: true, force: true });
		}
	});

	it("blocks a forced protected refspec after a separate option value", async () => {
		const fixture = createPushFixture();
		try {
			git(["checkout", "-b", "feature"], fixture.localDir);
			writeFileSync(join(fixture.localDir, "feature.txt"), "feature\n");
			git(["add", "feature.txt"], fixture.localDir);
			git(["commit", "-m", "Feature commit"], fixture.localDir);

			const result = await runGit(
				{
					op: "push",
					args: "--force --recurse-submodules check origin HEAD:main",
				},
				{ cwd: fixture.localDir },
			);

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain("force-push");
			expect(remoteMain(fixture)).toBe(fixture.remoteMain);
		} finally {
			rmSync(fixture.rootDir, { recursive: true, force: true });
		}
	});

	it("blocks a feature-branch force push to a protected destination", async () => {
		const fixture = createPushFixture();
		try {
			git(["checkout", "-b", "feature"], fixture.localDir);
			writeFileSync(join(fixture.localDir, "feature.txt"), "feature\n");
			git(["add", "feature.txt"], fixture.localDir);
			git(["commit", "-m", "Feature commit"], fixture.localDir);

			const result = await runGit(
				{ op: "push", args: "--force origin HEAD:refs/heads/main" },
				{ cwd: fixture.localDir },
			);

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain("force-push");
			expect(remoteMain(fixture)).toBe(fixture.remoteMain);
		} finally {
			rmSync(fixture.rootDir, { recursive: true, force: true });
		}
	});

	it("blocks a positive force refspec selected from remote config", async () => {
		const fixture = createPushFixture();
		try {
			git(["checkout", "-b", "feature"], fixture.localDir);
			writeFileSync(join(fixture.localDir, "feature.txt"), "feature\n");
			git(["add", "feature.txt"], fixture.localDir);
			git(["commit", "-m", "Feature commit"], fixture.localDir);
			git(["config", "remote.origin.push", "+HEAD:main"], fixture.localDir);

			const result = await runGit(
				{ op: "push", args: "origin" },
				{ cwd: fixture.localDir },
			);

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain("force-push");
			expect(remoteMain(fixture)).toBe(fixture.remoteMain);
		} finally {
			rmSync(fixture.rootDir, { recursive: true, force: true });
		}
	});

	it("blocks a forced upstream push when push.default targets protected main", async () => {
		const fixture = createPushFixture();
		try {
			git(["checkout", "-b", "feature"], fixture.localDir);
			writeFileSync(join(fixture.localDir, "feature.txt"), "feature\n");
			git(["add", "feature.txt"], fixture.localDir);
			git(["commit", "-m", "Feature commit"], fixture.localDir);
			git(["config", "branch.feature.remote", "origin"], fixture.localDir);
			git(["config", "branch.feature.merge", "refs/heads/main"], fixture.localDir);
			git(["config", "push.default", "upstream"], fixture.localDir);

			const result = await runGit(
				{ op: "push", args: "--force origin" },
				{ cwd: fixture.localDir },
			);

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain("force-push");
			expect(remoteMain(fixture)).toBe(fixture.remoteMain);
		} finally {
			rmSync(fixture.rootDir, { recursive: true, force: true });
		}
	});
});
