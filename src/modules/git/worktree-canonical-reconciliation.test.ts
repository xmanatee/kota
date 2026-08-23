import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkpointAndReconcileAutomationWorktree } from "./worktree-canonical-reconciliation.js";
import { isAutomationWorktreeCanonicalReconciliation } from "./worktree-canonical-reconciliation-record.js";
import {
	commit,
	git,
	reconciliationFixture,
	reconciliationInput,
	write,
} from "./worktree-canonical-reconciliation-test-support.js";
import {
	inspectAutomationWorktree,
	listAutomationWorktreeStatuses,
} from "./worktree-lifecycle.js";

describe("preserved worktree canonical reconciliation", () => {
	it("checkpoints tracked and untracked work before integrating unrelated canonical changes", async () => {
		const created = reconciliationFixture("unrelated", {
			"src/preserved.ts": "export const preserved = 1;\n",
		});
		write(created.workspaceDir, "src/preserved.ts", "export const preserved = 2;\n");
		write(created.workspaceDir, "notes/recovery.txt", "untracked recovery note\n");
		write(created.projectDir, "src/canonical.ts", "export const canonical = true;\n");
		const canonicalHead = commit(created.projectDir, "canonical change");
		const { input, phases } = reconciliationInput(created);

		const result = await checkpointAndReconcileAutomationWorktree(input);

		expect(result).toMatchObject({
			phase: "ready-to-resume",
			disposition: "ready-to-resume",
			originalBaseCommit: created.baseCommit,
			canonicalHeadCommit: canonicalHead,
			integratedCanonicalHeadCommit: canonicalHead,
			branchBehindAtStart: 1,
			branchBehindAtResume: 0,
			conflicts: [],
		});
		expect(result.checkpointCommit).not.toBeNull();
		expect(
			git(created.workspaceDir, [
				"show",
				`${result.checkpointCommit}:notes/recovery.txt`,
			]),
		).toBe("untracked recovery note");
		expect(
			git(created.workspaceDir, [
				"merge-base",
				"--is-ancestor",
				canonicalHead,
				"HEAD",
			]),
		).toBe("");
		expect(phases).toEqual([
			"checkpointing",
			"reconciling-canonical",
			"ready-to-resume",
		]);
		expect(result.validations).toMatchObject([{ passed: true }]);
		expect(
			JSON.parse(readFileSync(result.artifactPath, "utf8")),
		).toMatchObject({ branchBehindAtResume: 0, phase: "ready-to-resume" });
		expect(inspectAutomationWorktree(created).metadata).toMatchObject({
			baseCommit: created.baseCommit,
			canonicalReconciliation: {
				checkpointCommit: result.checkpointCommit,
				canonicalHeadCommit: canonicalHead,
				phase: "ready-to-resume",
			},
		});
		expect(listAutomationWorktreeStatuses(created.projectDir)[0]).toMatchObject({
			canonicalReconciliation: {
				phase: "ready-to-resume",
				disposition: "ready-to-resume",
				branchBehindAtResume: 0,
			},
		});
	});

	it("holds a canonical deletion conflict without dispatching the textual resolver", async () => {
		const created = reconciliationFixture("delete", {
			"src/legacy.ts": "export const value = 1;\n",
		});
		write(created.workspaceDir, "src/legacy.ts", "export const value = 2;\n");
		git(created.projectDir, ["rm", "src/legacy.ts"]);
		const canonicalHead = commit(created.projectDir, "delete legacy path");
		const resolver = vi.fn(() => ({ resolved: true, summary: "unexpected" }));
		const { input } = reconciliationInput(created, { resolver });

		const result = await checkpointAndReconcileAutomationWorktree(input);

		expect(result).toMatchObject({
			phase: "conflict-blocked",
			disposition: "needs-review",
			canonicalHeadCommit: canonicalHead,
			integratedCanonicalHeadCommit: null,
			canonicalDestructivePaths: ["src/legacy.ts"],
			conflicts: [
				{
					path: "src/legacy.ts",
					kind: "blocked-path",
				},
			],
		});
		expect(result.checkpointCommit).not.toBeNull();
		expect(resolver).not.toHaveBeenCalled();
		expect(inspectAutomationWorktree(created).metadata.state).toBe("pending-merge");
		expect(git(created.projectDir, ["ls-tree", "-r", "--name-only", "HEAD"])).not.toContain(
			"src/legacy.ts",
		);
	});

	it("integrates a canonical rename without resurrecting its source path", async () => {
		const content = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
		const created = reconciliationFixture("rename", {
			"src/legacy.ts": `${content}\n`,
		});
		write(
			created.workspaceDir,
			"src/legacy.ts",
			`${content.replace("line 10", "line ten changed by builder")}\n`,
		);
		git(created.projectDir, ["mv", "src/legacy.ts", "src/current.ts"]);
		const canonicalHead = commit(created.projectDir, "rename legacy path");
		const { input } = reconciliationInput(created);

		const result = await checkpointAndReconcileAutomationWorktree(input);

		expect(result).toMatchObject({
			disposition: "ready-to-resume",
			canonicalHeadCommit: canonicalHead,
			branchBehindAtResume: 0,
			canonicalDestructivePaths: ["src/legacy.ts"],
		});
		expect(existsSync(join(created.workspaceDir, "src/legacy.ts"))).toBe(false);
		expect(readFileSync(join(created.workspaceDir, "src/current.ts"), "utf8")).toContain(
			"line ten changed by builder",
		);
	});

	it("holds the integrated checkpoint for review when a reconciliation validation fails", async () => {
		const created = reconciliationFixture("failed-validation", {
			"src/preserved.ts": "export const preserved = 1;\n",
		});
		write(created.workspaceDir, "src/preserved.ts", "export const preserved = 2;\n");
		write(created.projectDir, "src/canonical.ts", "export const canonical = true;\n");
		const canonicalHead = commit(created.projectDir, "canonical change");
		const branchHead = git(created.workspaceDir, ["rev-parse", "HEAD"]);
		const { input, phases } = reconciliationInput(created, {
			validationCommands: [[process.execPath, "-e", "process.exit(23)"]],
		});

		const result = await checkpointAndReconcileAutomationWorktree(input);

		expect(result).toMatchObject({
			phase: "conflict-blocked",
			disposition: "needs-review",
			canonicalHeadCommit: canonicalHead,
			integratedCanonicalHeadCommit: null,
			branchBehindAtResume: null,
			validations: [{ exitCode: 23, passed: false }],
			reason: expect.stringContaining("canonical reconciliation validation failed"),
		});
		expect(phases.at(-1)).toBe("conflict-blocked");
		expect(git(created.workspaceDir, ["rev-parse", "HEAD"])).toBe(
			result.checkpointCommit,
		);
		expect(git(created.workspaceDir, ["rev-parse", "HEAD"])).not.toBe(branchHead);
		expect(() =>
			git(created.workspaceDir, ["merge-base", "--is-ancestor", canonicalHead, "HEAD"]),
		).toThrow();
		expect(git(created.workspaceDir, ["rev-parse", "MERGE_HEAD"])).toBe(canonicalHead);
		expect(inspectAutomationWorktree(created).metadata).toMatchObject({
			state: "pending-merge",
			canonicalReconciliation: {
				phase: "conflict-blocked",
				disposition: "needs-review",
				validations: [{ passed: false }],
			},
		});
		expect(isAutomationWorktreeCanonicalReconciliation({
			...result,
			phase: "ready-to-resume",
			disposition: "ready-to-resume",
			branchBehindAtResume: 0,
			reason: null,
		})).toBe(false);
	});

});
