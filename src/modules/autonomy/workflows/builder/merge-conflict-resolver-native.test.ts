import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentHarnessRunOptions } from "#core/agent-harness/index.js";
import { inspectAutomationWorktree } from "#modules/git/worktree-lifecycle.js";
import { mergeAutomationWorktree } from "#modules/git/worktree-merge-gate.js";
import {
	cleanupMergeResolverFixtures,
	git,
	makeMergeConflictFixture,
	nativeMergeResolver,
	registerHarness,
} from "./merge-conflict-resolver-test-support.js";

afterEach(cleanupMergeResolverFixtures);

describe("native merge-conflict resolution", () => {
	it("resolves and merges a real divergent text conflict", async () => {
		const { projectDir, worktree } = makeMergeConflictFixture();
		const run = registerHarness("native", "codex");
		run.mockImplementationOnce(async (options: AgentHarnessRunOptions) => {
			options.abortQuarantine?.register(() => undefined);
			if (!options.cwd) throw new Error("native resolver fixture requires cwd");
			writeFileSync(join(options.cwd, "settings.txt"), "value=reconciled\n", "utf8");
			return {
				text: "preserved the task setting while accepting canonical intent",
				streamedText: "preserved the task setting while accepting canonical intent",
				turns: 1,
				isError: false,
			};
		});

		const result = await mergeAutomationWorktree({
			projectDir,
			taskId: worktree.metadata.taskId,
			runId: worktree.metadata.runId,
			validationCommand: ["node", "-e", "process.exit(0)"],
			resolver: nativeMergeResolver(projectDir, worktree.metadata.runId),
			maxResolutionAttempts: 2,
		});

		expect(result).toMatchObject({
			status: "merged",
			reason: null,
			resolutionAttempts: 1,
			validation: { passed: true },
		});
		expect(run).toHaveBeenCalledTimes(2);
		expect(run.mock.calls[0]?.[0].agentWriteScope).toEqual(["settings.txt"]);
		expect(run.mock.calls[1]?.[0].agentWriteScope).toBe("deny-all");
		expect(readFileSync(join(projectDir, "settings.txt"), "utf8")).toBe("value=reconciled\n");
		expect(
			inspectAutomationWorktree({
				projectDir,
				taskId: worktree.metadata.taskId,
				runId: worktree.metadata.runId,
			}).metadata,
		).toMatchObject({ state: "merged" });
	});

	it("preserves output for review when the native resolver edits an unrelated path", async () => {
		const { projectDir, worktree } = makeMergeConflictFixture();
		const run = registerHarness("native", "codex");
		run.mockImplementationOnce(async (options: AgentHarnessRunOptions) => {
			options.abortQuarantine?.register(() => undefined);
			if (!options.cwd) throw new Error("native resolver fixture requires cwd");
			writeFileSync(join(options.cwd, "settings.txt"), "value=reconciled\n", "utf8");
			writeFileSync(join(options.cwd, "unrelated.txt"), "out of scope\n", "utf8");
			return {
				text: "resolved with an unrelated side effect",
				streamedText: "resolved with an unrelated side effect",
				turns: 1,
				isError: false,
			};
		});

		const result = await mergeAutomationWorktree({
			projectDir,
			taskId: worktree.metadata.taskId,
			runId: worktree.metadata.runId,
			validationCommand: ["node", "-e", "process.exit(0)"],
			resolver: nativeMergeResolver(projectDir, "run-native-negative"),
			maxResolutionAttempts: 1,
		});

		expect(result).toMatchObject({
			status: "blocked",
			reason: "merge resolver left untracked paths outside allowed textual conflicts",
			conflicts: [{ path: "unrelated.txt", kind: "blocked-path" }],
			validation: null,
		});
		expect(git(worktree.metadata.workspaceDir, ["ls-files", "unrelated.txt"])).toBe("");
		expect(readFileSync(join(projectDir, "settings.txt"), "utf8")).toBe("value=canonical\n");
	});
});
