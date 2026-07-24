import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "./git.js";

let projectDir: string;
let rootDir: string;

function git(args: readonly string[]): void {
	execFileSync("git", args, {
		cwd: projectDir,
		env: {
			...process.env,
			GIT_AUTHOR_EMAIL: "test@test.com",
			GIT_AUTHOR_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@test.com",
			GIT_COMMITTER_NAME: "Test",
		},
	});
}

beforeEach(() => {
	rootDir = mkdtempSync(join(tmpdir(), "kota-git-arguments-"));
	projectDir = join(rootDir, "project");
	mkdirSync(projectDir);
	git(["init", "-b", "main"]);
	writeFileSync(join(projectDir, "README.md"), "# Test\n");
	git(["add", "README.md"]);
	git(["commit", "-m", "Initial commit"]);
});

afterEach(() => {
	rmSync(rootDir, { recursive: true, force: true });
});

describe("git operation argument boundary", () => {
	it("does not overwrite an absolute --output target through log", async () => {
		const target = join(rootDir, "existing-output.txt");
		writeFileSync(target, "sentinel\n");

		const result = await runGit(
			{ op: "log", args: `-1 --format=%B --output=${target}` },
			{ cwd: projectDir },
		);

		expect(result).toMatchObject({ is_error: true });
		expect(result.content).toContain("--output");
		expect(readFileSync(target, "utf8")).toBe("sentinel\n");
	});

	it("does not create an absolute target through a separate --output value", async () => {
		const target = join(rootDir, "new-output.txt");

		const result = await runGit(
			{ op: "log", args: `-1 --output ${target}` },
			{ cwd: projectDir },
		);

		expect(result).toMatchObject({ is_error: true });
		expect(result.content).toContain("--output");
		expect(existsSync(target)).toBe(false);
	});

	it.each([
		["--format", "--format"],
		["--pretty", "--output"],
	])(
		"does not let bare %s hide a following file-writing option",
		async (displayOption, rejectedOption) => {
			const target = join(
				rootDir,
				`${displayOption.slice(2)}-confusion-output.txt`,
			);

			const result = await runGit(
				{
					op: "log",
					args: `-1 ${displayOption} --output=${target}`,
				},
				{ cwd: projectDir },
			);

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain(rejectedOption);
			expect(existsSync(target)).toBe(false);
		},
	);

	it.each(["diff", "log", "show", "add"] as const)(
		"rejects absolute local paths for %s",
		async (op) => {
			const outsidePath = join(rootDir, "outside.txt");
			const result = await runGit(
				{ op, args: outsidePath },
				{ cwd: projectDir },
			);

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain("outside the project");
		},
	);

	it("rejects a project-external local push target", async () => {
		const outsideRepository = join(rootDir, "outside.git");

		const result = await runGit(
			{ op: "push", args: `${outsideRepository} HEAD:main` },
			{ cwd: projectDir },
		);

		expect(result).toMatchObject({ is_error: true });
		expect(result.content).toContain("outside the project");
	});

	it("does not push through a project symlink to an external repository", async () => {
		const outsideRepository = join(rootDir, "outside.git");
		git(["init", "--bare", outsideRepository]);
		symlinkSync(outsideRepository, join(projectDir, "inside-link.git"), "dir");

		const result = await runGit(
			{
				op: "push",
				args: "inside-link.git HEAD:refs/heads/topic",
			},
			{ cwd: projectDir },
		);

		expect(result).toMatchObject({ is_error: true });
		expect(result.content).toContain("outside the project");
		expect(() =>
			execFileSync(
				"git",
				[
					"--git-dir",
					outsideRepository,
					"rev-parse",
					"--verify",
					"refs/heads/topic",
				],
				{ stdio: "pipe" },
			),
		).toThrow();
	});

	it.each([
		["status", "--porcelain=v2", "does not accept arguments"],
		["diff", "--ext-diff", "--ext-diff"],
		["log", "--config=core.pager=cat", "--config"],
		["show", "--output=outside", "--output"],
		["add", "../outside.txt", "outside the project"],
		["branch", "checkout main extra", "branch arguments"],
		["push", "--exec=receive-pack origin", "--exec"],
	] as const)(
		"rejects disallowed %s arguments before invoking Git",
		async (op, args, message) => {
			const result = await runGit({ op, args }, { cwd: projectDir });

			expect(result).toMatchObject({ is_error: true });
			expect(result.content).toContain(message);
		},
	);
});
