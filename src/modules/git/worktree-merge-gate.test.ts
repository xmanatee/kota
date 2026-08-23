import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	cleanupAutomationWorktree,
	inspectAutomationWorktree,
	lockAutomationWorktree,
} from "./worktree-lifecycle.js";
import { mergeAutomationWorktree } from "./worktree-merge-gate.js";
import {
	cleanupMergeGateFixtures,
	commitFile,
	createFixtureWorktree,
	git,
	initRepo,
} from "./worktree-merge-gate-test-support.js";

afterEach(cleanupMergeGateFixtures);

describe("automation worktree merge gate", () => {
	it("records a blocked disposition when registered worktree storage is missing", async () => {
		const repo = initRepo("missing");
		const created = createFixtureWorktree(repo);
		git(repo, ["worktree", "remove", "--force", created.metadata.workspaceDir]);

		const result = await mergeAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});

		expect(result).toMatchObject({
			status: "blocked",
			headCommit: "",
			reason: "worktree path is missing",
		});
		expect(JSON.parse(readFileSync(result.artifactPath, "utf8"))).toMatchObject({
			status: "blocked",
			reason: "worktree path is missing",
		});
	});

	it("fast-forwards a clean task branch into the canonical checkout and then cleans up the worktree", async () => {
		const repo = initRepo("clean");
		const created = createFixtureWorktree(repo);
		const locked = lockAutomationWorktree(
			{ projectDir: repo, taskId: created.metadata.taskId, runId: created.metadata.runId },
			"builder agent running",
		);
		expect(locked.lock).toEqual({ locked: true, reason: "builder agent running" });
		commitFile(created.metadata.workspaceDir, "feature.txt", "ready\n", "add feature");

		const result = await mergeAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
			validationCommand: ["node", "-e", "process.exit(0)"],
		});

		expect(result).toMatchObject({ status: "merged", reason: null });
		expect(result.validation?.passed).toBe(true);
		expect(readFileSync(join(repo, "feature.txt"), "utf8")).toBe("ready\n");

		const inspection = inspectAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(inspection.metadata.state).toBe("merged");
		expect(inspection.metadata.mergedCommit).toBe(result.mergeCommit);
		expect(inspection.lock.locked).toBe(false);
		expect(inspection.cleanup.blockers).toEqual([]);

		const cleanup = cleanupAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(cleanup.removed).toBe(true);
		expect(existsSync(created.metadata.workspaceDir)).toBe(false);
	});

	it("persists a pending merge when the canonical checkout becomes dirty", async () => {
		const repo = initRepo("canonical-dirty");
		const created = createFixtureWorktree(repo);
		commitFile(created.metadata.workspaceDir, "feature.txt", "ready\n", "add feature");
		writeFileSync(join(repo, "concurrent.txt"), "canonical mutation in progress\n", "utf8");

		const result = await mergeAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
			validationCommand: ["node", "-e", "process.exit(0)"],
		});

		expect(result.status).toBe("blocked");
		expect(result.reason).toBe(
			"canonical checkout is dirty before merge gate: ?? concurrent.txt",
		);
		expect(readFileSync(join(repo, "concurrent.txt"), "utf8")).toBe(
			"canonical mutation in progress\n",
		);
		expect(existsSync(join(repo, "feature.txt"))).toBe(false);
		expect(JSON.parse(readFileSync(result.artifactPath, "utf8"))).toMatchObject({
			status: "blocked",
			reason: "canonical checkout is dirty before merge gate: ?? concurrent.txt",
		});

		const inspection = inspectAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(inspection.metadata.state).toBe("pending-merge");
		expect(inspection.metadata.stateReason).toBe(
			"canonical checkout is dirty before merge gate: ?? concurrent.txt",
		);
	});

	it("invokes a bounded resolver for text conflicts and validates the resolved merge before fast-forwarding", async () => {
		const repo = initRepo("text");
		commitFile(repo, "settings.txt", "value=base\n", "add settings");
		const created = createFixtureWorktree(repo);
		commitFile(created.metadata.workspaceDir, "settings.txt", "value=branch\n", "branch setting");
		commitFile(repo, "settings.txt", "value=canonical\n", "canonical setting");
		let attempts = 0;

		const result = await mergeAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
			validationCommand: [
				"node",
				"-e",
				[
					"const resolved = require('fs').readFileSync('settings.txt','utf8') === 'value=resolved\\n'",
					"const unmerged = require('child_process').execFileSync('git',['ls-files','-u','--','settings.txt'],{encoding:'utf8'}).trim().length > 0",
					"process.exit(resolved && unmerged ? 0 : 1)",
				].join("; "),
			],
			resolver: ({ workspaceDir, conflicts, previousValidation }) => {
				attempts += 1;
				expect(previousValidation).toBeNull();
				expect(conflicts).toEqual([
					{ path: "settings.txt", kind: "text", reason: "text conflict can be resolved by a bounded resolver" },
				]);
				writeFileSync(join(workspaceDir, "settings.txt"), "value=resolved\n", "utf8");
				return { resolved: true, summary: "resolved settings conflict" };
			},
			maxResolutionAttempts: 2,
		});

		expect(result).toMatchObject({ status: "merged", reason: null });
		expect(attempts).toBe(1);
		expect(result.resolutionAttempts).toBe(1);
		expect(result.validation?.passed).toBe(true);
		expect(readFileSync(join(repo, "settings.txt"), "utf8")).toBe("value=resolved\n");
	});

	it("blocks resolver-staged paths outside the allowed textual conflicts before validation or commit", async () => {
		const repo = initRepo("resolver-boundary");
		commitFile(repo, "settings.txt", "value=base\n", "add settings");
		const created = createFixtureWorktree(repo);
		commitFile(created.metadata.workspaceDir, "settings.txt", "value=branch\n", "branch setting");
		commitFile(repo, "settings.txt", "value=canonical\n", "canonical setting");

		const result = await mergeAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
			validationCommand: ["node", "-e", "process.exit(0)"],
			resolver: ({ workspaceDir }) => {
				writeFileSync(join(workspaceDir, "settings.txt"), "value=resolved\n", "utf8");
				writeFileSync(join(workspaceDir, "sneaky.bin"), "resolver side effect\n", "utf8");
				git(workspaceDir, ["add", "sneaky.bin"]);
				return { resolved: true, summary: "resolved settings conflict with side effect" };
			},
			maxResolutionAttempts: 1,
		});

		expect(result.status).toBe("blocked");
		expect(result.reason).toBe("merge resolver staged paths outside allowed textual conflicts");
		expect(result.conflicts).toEqual([
			{
				path: "sneaky.bin",
				kind: "blocked-path",
				reason: "resolver staged path outside allowed textual conflicts",
			},
		]);
		expect(result.validation).toBeNull();
		expect(readFileSync(join(repo, "settings.txt"), "utf8")).toBe("value=canonical\n");
		expect(git(repo, ["ls-files", "sneaky.bin"])).toBe("");
	});

	it("persists pending merge state when a successful resolver aborts the merge before commit", async () => {
		const repo = initRepo("resolver-abort");
		commitFile(repo, "settings.txt", "value=base\n", "add settings");
		const created = createFixtureWorktree(repo);
		commitFile(created.metadata.workspaceDir, "settings.txt", "value=branch\n", "branch setting");
		commitFile(repo, "settings.txt", "value=canonical\n", "canonical setting");

		const result = await mergeAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
			validationCommand: ["node", "-e", "process.exit(0)"],
			resolver: ({ workspaceDir }) => {
				git(workspaceDir, ["merge", "--abort"]);
				return { resolved: true, summary: "incorrectly reported resolution after aborting merge" };
			},
			maxResolutionAttempts: 1,
		});

		expect(result.status).toBe("blocked");
		expect(result.reason).toBe("resolved merge is no longer in progress before commit");
		expect(result.resolutionAttempts).toBe(1);
		expect(existsSync(result.artifactPath)).toBe(true);
		expect(JSON.parse(readFileSync(result.artifactPath, "utf8"))).toMatchObject({
			status: "blocked",
			reason: "resolved merge is no longer in progress before commit",
		});

		const inspection = inspectAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(inspection.metadata.state).toBe("pending-merge");
		expect(inspection.metadata.stateReason).toBe("resolved merge is no longer in progress before commit");
		expect(readFileSync(join(repo, "settings.txt"), "utf8")).toBe("value=canonical\n");
	});

	it("blocks resolver output that still contains conflict markers before staging", async () => {
		const repo = initRepo("markers");
		commitFile(repo, "settings.txt", "value=base\n", "add settings");
		const created = createFixtureWorktree(repo);
		commitFile(created.metadata.workspaceDir, "settings.txt", "value=branch\n", "branch setting");
		commitFile(repo, "settings.txt", "value=canonical\n", "canonical setting");

		const result = await mergeAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
			validationCommand: [
				"node",
				"-e",
				"process.exit(require('fs').readFileSync('settings.txt','utf8').includes('<<<<<<<') ? 1 : 0)",
			],
			resolver: ({ workspaceDir }) => {
				writeFileSync(
					join(workspaceDir, "settings.txt"),
					"<<<<<<< HEAD\nvalue=branch\n=======\nvalue=canonical\n>>>>>>> main\n",
					"utf8",
				);
				return { resolved: true, summary: "left markers behind" };
			},
			maxResolutionAttempts: 1,
		});

		expect(result.status).toBe("blocked");
		expect(result.reason).toBe("merge resolver exhausted bounded attempts");
		expect(result.conflicts).toEqual([
			{
				path: "settings.txt",
				kind: "text",
				reason: "unresolved conflict markers remain after resolver attempt",
			},
		]);
		expect(result.validation?.passed).toBe(false);
		expect(readFileSync(join(repo, "settings.txt"), "utf8")).toBe("value=canonical\n");
		expect(git(created.metadata.workspaceDir, ["status", "--short"])).toContain("UU settings.txt");
	});

	it("refuses automated resolution for binary conflicts and persists pending merge state", async () => {
		const repo = initRepo("binary");
		writeFileSync(join(repo, ".gitattributes"), "*.bin binary\n", "utf8");
		writeFileSync(join(repo, "asset.bin"), "base\n", "utf8");
		git(repo, ["add", ".gitattributes", "asset.bin"]);
		git(repo, ["commit", "--quiet", "-m", "add binary asset"]);
		const created = createFixtureWorktree(repo);
		commitFile(created.metadata.workspaceDir, "asset.bin", "branch\n", "branch asset");
		commitFile(repo, "asset.bin", "canonical\n", "canonical asset");

		const result = await mergeAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
			validationCommand: ["node", "-e", "process.exit(0)"],
			resolver: () => {
				throw new Error("binary resolver should not run");
			},
		});

		expect(result.status).toBe("blocked");
		expect(result.reason).toBe(
			"merge contains binary, generated, deletion, rename, or high-risk conflicts",
		);
		expect(result.conflicts).toEqual([
			{ path: "asset.bin", kind: "binary", reason: "binary conflict requires manual merge" },
		]);

		const inspection = inspectAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
		});
		expect(inspection.metadata.state).toBe("pending-merge");
		expect(inspection.cleanup.blockers).toEqual(
			expect.arrayContaining([
				"worktree has conflicted paths",
				"worktree is pending merge",
			]),
		);
		expect(existsSync(result.artifactPath)).toBe(true);
	});

	it.each([
		{ label: "branch-delete", branchDeletes: true },
		{ label: "canonical-delete", branchDeletes: false },
	])("keeps $label conflicts away from the textual resolver", async ({ label, branchDeletes }) => {
		const repo = initRepo(label);
		commitFile(repo, "settings.txt", "value=base\n", "add settings");
		const created = createFixtureWorktree(repo);
		if (branchDeletes) {
			git(created.metadata.workspaceDir, ["rm", "settings.txt"]);
			git(created.metadata.workspaceDir, ["commit", "--quiet", "-m", "branch deletes settings"]);
			commitFile(repo, "settings.txt", "value=canonical\n", "canonical modifies settings");
		} else {
			commitFile(created.metadata.workspaceDir, "settings.txt", "value=branch\n", "branch modifies settings");
			git(repo, ["rm", "settings.txt"]);
			git(repo, ["commit", "--quiet", "-m", "canonical deletes settings"]);
		}

		const result = await mergeAutomationWorktree({
			projectDir: repo,
			taskId: created.metadata.taskId,
			runId: created.metadata.runId,
			validationCommand: ["node", "-e", "process.exit(0)"],
			resolver: () => {
				throw new Error("delete/modify conflict must not reach the textual resolver");
			},
		});

		expect(result).toMatchObject({
			status: "blocked",
			reason: "merge contains binary, generated, deletion, rename, or high-risk conflicts",
			conflicts: [{
				path: "settings.txt",
				kind: "blocked-path",
				reason: "delete/modify or structural conflict requires explicit disposition evidence",
			}],
			validation: null,
		});
	});
});
