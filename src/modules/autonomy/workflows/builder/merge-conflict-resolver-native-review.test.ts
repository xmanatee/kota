import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentHarnessRunOptions } from "#core/agent-harness/index.js";
import {
	claimTask,
	continueTaskClaim,
	markTaskClaimPendingMerge,
	readActiveTaskClaim,
} from "#modules/autonomy/task-claims.js";
import { checkpointAndReconcileAutomationWorktree } from "#modules/git/worktree-canonical-reconciliation.js";
import {
	inspectAutomationWorktree,
	markAutomationWorktreePendingMerge,
} from "#modules/git/worktree-lifecycle.js";
import { readVerifiedRepoTaskFile } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
	cleanupMergeResolverFixtures,
	git,
	makeMergeConflictFixture,
	nativeMergeResolver,
	persistNativeRecoveryProgress,
	registerHarness,
} from "./merge-conflict-resolver-test-support.js";
import { listPendingBuilderRecoveries } from "./recovery-continuation.js";

afterEach(cleanupMergeResolverFixtures);

describe("native merge-conflict semantic review", () => {
	it("keeps a continued claim pending when the resolution is ambiguous", async () => {
		const { projectDir, worktree } = makeMergeConflictFixture();
		const originalRunId = worktree.metadata.runId;
		const recoveryRunId = "run-native-ambiguous-recovery";
		const canonicalHead = git(projectDir, ["rev-parse", "HEAD"]);
		expect(() =>
			git(worktree.metadata.workspaceDir, ["merge", "--no-ff", "--no-commit", canonicalHead]),
		).toThrow();
		markAutomationWorktreePendingMerge(
			{
				projectDir,
				taskId: worktree.metadata.taskId,
				runId: originalRunId,
			},
			"native textual conflict awaits bounded recovery",
		);
		const task = readVerifiedRepoTaskFile(projectDir, "ready", worktree.metadata.taskId);
		if (!task) throw new Error("native recovery fixture task is missing");
		expect(
			claimTask({
				projectDir,
				taskId: worktree.metadata.taskId,
				taskState: "ready",
				taskFile: { path: task.path, snapshot: task.snapshot },
				runId: originalRunId,
				workflowId: "builder",
				owner: "workflow:builder",
				workspaceDir: worktree.metadata.workspaceDir,
				branch: worktree.metadata.branch,
				baseCommit: worktree.metadata.baseCommit,
			}),
		).toMatchObject({ claimed: true });
		expect(
			markTaskClaimPendingMerge({
				projectDir,
				taskId: worktree.metadata.taskId,
				runId: originalRunId,
				workflowId: "builder",
				evidence: "native textual conflict awaits bounded recovery",
			}),
		).toMatchObject({ changed: true, claim: { status: "pending-merge" } });
		expect(
			continueTaskClaim({
				projectDir,
				taskId: worktree.metadata.taskId,
				sourceRunId: originalRunId,
				runId: recoveryRunId,
				workflowId: "builder",
				owner: "workflow:builder",
				evidence: "continued preserved native merge recovery",
			}),
		).toMatchObject({
			claimed: true,
			recoveryPath: "continued-preserved-claim",
			claim: { runId: recoveryRunId, worktreeRunId: originalRunId },
		});

		const run = registerHarness("native", "codex");
		run.mockImplementationOnce(async (options: AgentHarnessRunOptions) => {
			options.abortQuarantine?.register(() => undefined);
			if (!options.cwd) throw new Error("native resolver fixture requires cwd");
			writeFileSync(join(options.cwd, "settings.txt"), "value=plausible-but-ambiguous\n", "utf8");
			return {
				text: "selected a syntactically clean value",
				streamedText: "selected a syntactically clean value",
				turns: 1,
				isError: false,
			};
		});
		run.mockImplementationOnce(async (options: AgentHarnessRunOptions) => {
			options.abortQuarantine?.register(() => undefined);
			return {
				text: JSON.stringify({
					verdict: "needs-review",
					summary: "The selected value is not justified by the task or either side of the conflict.",
					taskScopeJustification: "The task contract does not establish a third setting value.",
					pathJudgments: [
						{
							path: "settings.txt",
							decision: "combine",
							rationale: "Neither branch nor canonical intent supports the new value.",
						},
					],
				}),
				streamedText: "",
				turns: 1,
				isError: false,
			};
		});
		const result = await checkpointAndReconcileAutomationWorktree({
			projectDir,
			taskId: worktree.metadata.taskId,
			runId: originalRunId,
			recoveryRunId,
			artifactPath: join(
				projectDir,
				".kota/runs",
				recoveryRunId,
				"preserved-canonical-reconciliation.json",
			),
			validationCommands: [["node", "-e", "process.exit(0)"]],
			resolver: nativeMergeResolver(projectDir, recoveryRunId),
			maxResolutionAttempts: 1,
			onProgress: persistNativeRecoveryProgress({
				projectDir,
				taskId: worktree.metadata.taskId,
				worktreeRunId: originalRunId,
				recoveryRunId,
			}),
		});
		expect(result).toMatchObject({
			phase: "conflict-blocked",
			disposition: "needs-review",
			reason: "The selected value is not justified by the task or either side of the conflict.",
			conflicts: [{ path: "settings.txt", kind: "text" }],
			validations: [],
		});
		expect(
			markTaskClaimPendingMerge({
				projectDir,
				taskId: worktree.metadata.taskId,
				runId: recoveryRunId,
				workflowId: "builder",
				evidence: `preserved canonical reconciliation needs review: ${result.reason}`,
			}),
		).toMatchObject({ changed: true, claim: { status: "pending-merge" } });
		expect(readActiveTaskClaim(projectDir, worktree.metadata.taskId)).toMatchObject({
			runId: recoveryRunId,
			worktreeRunId: originalRunId,
			status: "pending-merge",
		});
		expect(
			inspectAutomationWorktree({
				projectDir,
				taskId: worktree.metadata.taskId,
				runId: originalRunId,
			}).metadata.state,
		).toBe("pending-merge");
		expect(git(worktree.metadata.workspaceDir, ["rev-parse", "MERGE_HEAD"])).toBe(canonicalHead);
		expect(git(worktree.metadata.workspaceDir, ["ls-files", "-u", "--", "settings.txt"])).not.toBe("");
		expect(listPendingBuilderRecoveries(projectDir)).toEqual([]);
	});
});
