import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkpointAndReconcileAutomationWorktree } from "./worktree-canonical-reconciliation.js";
import {
	commit,
	git,
	reconciliationFixture,
	reconciliationInput,
	write,
} from "./worktree-canonical-reconciliation-test-support.js";
import {
	inspectAutomationWorktree,
	markAutomationWorktreePendingMerge,
} from "./worktree-lifecycle.js";

describe("pending-merge canonical reconciliation", () => {
	it("resolves an existing runtime-owned text conflict before reconciling the latest canonical head", async () => {
		const created = reconciliationFixture("pending-text", {
			"settings.txt": "value=base\n",
		});
		write(created.workspaceDir, "settings.txt", "value=branch\n");
		const branchHead = commit(created.workspaceDir, "branch setting");
		write(created.projectDir, "settings.txt", "value=canonical\n");
		const pendingCanonicalHead = commit(created.projectDir, "canonical setting");
		expect(() =>
			git(created.workspaceDir, [
				"merge",
				"--no-ff",
				"--no-commit",
				pendingCanonicalHead,
			]),
		).toThrow();
		markAutomationWorktreePendingMerge(
			created,
			"native resolver deferred the textual conflict",
		);
		write(created.projectDir, "canonical-latest.txt", "latest canonical work\n");
		const latestCanonicalHead = commit(created.projectDir, "latest canonical change");
		const resolver = vi.fn((request) => {
			write(request.workspaceDir, "settings.txt", "value=reconciled\n");
			return { resolved: true, summary: "reconciled the pending text conflict" };
		});
		const { input } = reconciliationInput(created, { resolver });

		const result = await checkpointAndReconcileAutomationWorktree(input);

		expect(result).toMatchObject({
			phase: "ready-to-resume",
			disposition: "ready-to-resume",
			checkpointCommit: branchHead,
			canonicalHeadCommit: latestCanonicalHead,
			integratedCanonicalHeadCommit: latestCanonicalHead,
			branchBehindAtResume: 0,
			conflicts: [],
			validations: [{ passed: true }],
		});
		expect(resolver).toHaveBeenCalledOnce();
		expect(resolver.mock.calls[0]?.[0]).toMatchObject({
			taskId: created.taskId,
			baseCommit: created.baseCommit,
			canonicalHeadCommit: pendingCanonicalHead,
			headCommit: branchHead,
			conflicts: [{ path: "settings.txt", kind: "text" }],
		});
		expect(resolver.mock.calls[0]?.[0].canonicalDiff).toContain("value=canonical");
		expect(readFileSync(join(created.workspaceDir, "settings.txt"), "utf8")).toBe(
			"value=reconciled\n",
		);
		expect(
			git(created.workspaceDir, ["merge-base", "--is-ancestor", latestCanonicalHead, "HEAD"]),
		).toBe("");
	});

	it("holds a pending merge when the resolver changes an unrelated path", async () => {
		const created = reconciliationFixture("pending-scope", {
			"settings.txt": "value=base\n",
		});
		write(created.workspaceDir, "settings.txt", "value=branch\n");
		commit(created.workspaceDir, "branch setting");
		write(created.projectDir, "settings.txt", "value=canonical\n");
		const canonicalHead = commit(created.projectDir, "canonical setting");
		expect(() =>
			git(created.workspaceDir, [
				"merge",
				"--no-ff",
				"--no-commit",
				canonicalHead,
			]),
		).toThrow();
		markAutomationWorktreePendingMerge(created, "pending native conflict");
		const { input } = reconciliationInput(created, {
			resolver: (request) => {
				write(request.workspaceDir, "settings.txt", "value=reconciled\n");
				write(request.workspaceDir, "unrelated.txt", "out of scope\n");
				return { resolved: true, summary: "included an unrelated edit" };
			},
		});

		const result = await checkpointAndReconcileAutomationWorktree(input);

		expect(result).toMatchObject({
			phase: "conflict-blocked",
			disposition: "needs-review",
			reason: "merge resolver left untracked paths outside allowed textual conflicts",
			conflicts: [{ path: "unrelated.txt", kind: "blocked-path" }],
			validations: [],
		});
		expect(git(created.workspaceDir, ["ls-files", "unrelated.txt"])).toBe("");
		expect(git(created.projectDir, ["rev-parse", "HEAD"])).toBe(canonicalHead);
		expect(inspectAutomationWorktree(created).metadata.state).toBe("pending-merge");
	});

	it("validates resolver output while the conflict index is still unmerged", async () => {
		const created = reconciliationFixture("pre-stage-validation", {
			"settings.txt": "value=base\n",
		});
		write(created.workspaceDir, "settings.txt", "value=branch\n");
		commit(created.workspaceDir, "branch setting");
		write(created.projectDir, "settings.txt", "value=canonical\n");
		const canonicalHead = commit(created.projectDir, "canonical setting");
		expect(() =>
			git(created.workspaceDir, ["merge", "--no-ff", "--no-commit", canonicalHead]),
		).toThrow();
		markAutomationWorktreePendingMerge(created, "pre-stage validation fixture");
		const { input } = reconciliationInput(created, {
			resolver: (request) => {
				write(request.workspaceDir, "settings.txt", "value=reconciled\n");
				return { resolved: true, summary: "reconciled settings" };
			},
			validationCommands: [[
				process.execPath,
				"-e",
				[
					'const { execFileSync } = require("node:child_process")',
					'const { readFileSync } = require("node:fs")',
					'if (!execFileSync("git", ["ls-files", "-u", "--", "settings.txt"], { encoding: "utf8" }).trim()) process.exit(21)',
					'if (readFileSync("settings.txt", "utf8") !== "value=reconciled\\n") process.exit(22)',
				].join("; "),
			]],
		});

		const result = await checkpointAndReconcileAutomationWorktree(input);

		expect(result).toMatchObject({
			phase: "ready-to-resume",
			integratedCanonicalHeadCommit: canonicalHead,
			validations: [{ passed: true }],
			reason: null,
		});
		expect(git(created.workspaceDir, ["ls-files", "-u", "--", "settings.txt"])).toBe("");
	});

	it("leaves failed resolver output unmerged and unstaged", async () => {
		const created = reconciliationFixture("failed-conflict-validation", {
			"settings.txt": "value=base\n",
		});
		write(created.workspaceDir, "settings.txt", "value=branch\n");
		const branchHead = commit(created.workspaceDir, "branch setting");
		write(created.projectDir, "settings.txt", "value=canonical\n");
		const canonicalHead = commit(created.projectDir, "canonical setting");
		expect(() =>
			git(created.workspaceDir, ["merge", "--no-ff", "--no-commit", canonicalHead]),
		).toThrow();
		markAutomationWorktreePendingMerge(created, "failed pre-stage validation fixture");
		const { input } = reconciliationInput(created, {
			resolver: (request) => {
				write(request.workspaceDir, "settings.txt", "value=invalid\n");
				return { resolved: true, summary: "invalid resolution" };
			},
			maxResolutionAttempts: 1,
			validationCommands: [[process.execPath, "-e", "process.exit(23)"]],
		});

		const result = await checkpointAndReconcileAutomationWorktree(input);

		expect(result).toMatchObject({
			phase: "conflict-blocked",
			integratedCanonicalHeadCommit: null,
			validations: [{ exitCode: 23, passed: false }],
		});
		expect(git(created.workspaceDir, ["rev-parse", "HEAD"])).toBe(branchHead);
		expect(git(created.workspaceDir, ["rev-parse", "MERGE_HEAD"])).toBe(canonicalHead);
		expect(git(created.workspaceDir, ["ls-files", "-u", "--", "settings.txt"])).not.toBe("");
	});

	it("holds a branch-side rename conflict without dispatching the textual resolver", async () => {
		const original = `${Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n")}\n`;
		const created = reconciliationFixture("pending-branch-rename", {
			"src/legacy.ts": original,
		});
		git(created.workspaceDir, ["mv", "src/legacy.ts", "src/current.ts"]);
		write(created.workspaceDir, "src/current.ts", original.replace("line 10", "branch ten"));
		const branchHead = commit(created.workspaceDir, "branch renames legacy path");
		write(created.projectDir, "src/legacy.ts", original.replace("line 10", "canonical ten"));
		const canonicalHead = commit(created.projectDir, "canonical modifies legacy path");
		expect(() =>
			git(created.workspaceDir, ["merge", "--no-ff", "--no-commit", canonicalHead]),
		).toThrow();
		markAutomationWorktreePendingMerge(created, "pending branch-side rename conflict");
		const resolver = vi.fn(() => ({ resolved: true, summary: "unexpected" }));
		const { input } = reconciliationInput(created, { resolver });

		const result = await checkpointAndReconcileAutomationWorktree(input);

		expect(result).toMatchObject({
			phase: "conflict-blocked",
			disposition: "needs-review",
			checkpointCommit: branchHead,
			canonicalHeadCommit: canonicalHead,
			reason: "pending canonical merge contains binary, generated, deletion, rename, or high-risk conflicts",
			conflicts: [{
				path: "src/current.ts",
				kind: "blocked-path",
				reason: "rename conflict requires explicit disposition evidence",
			}],
		});
		expect(resolver).not.toHaveBeenCalled();
		expect(git(created.workspaceDir, ["ls-files", "-u", "--", "src/current.ts"])).not.toBe("");
	});
});
