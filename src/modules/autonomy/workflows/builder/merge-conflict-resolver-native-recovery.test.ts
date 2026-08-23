import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentHarnessRunOptions } from "#core/agent-harness/index.js";
import {
	claimTask,
	continueTaskClaim,
	markTaskClaimPendingMerge,
	readActiveTaskClaim,
	releaseTaskClaim,
} from "#modules/autonomy/task-claims.js";
import { listRecoveryClaims } from "#modules/autonomy/workflow-state-recovery-claims.js";
import { codexAgentHarness } from "#modules/codex-agent-harness/adapter.js";
import { checkpointAndReconcileAutomationWorktree } from "#modules/git/worktree-canonical-reconciliation.js";
import {
	cleanupAutomationWorktree,
	markAutomationWorktreePendingMerge,
} from "#modules/git/worktree-lifecycle.js";
import { mergeAutomationWorktree } from "#modules/git/worktree-merge-gate.js";
import { readVerifiedRepoTaskFile } from "#modules/repo-tasks/repo-tasks-domain.js";
import { registerCodexAdapterFixture } from "./merge-conflict-resolver-codex-adapter-test-support.js";
import {
	cleanupMergeResolverFixtures,
	git,
	makeMergeConflictFixture,
	nativeMergeResolver,
	persistNativeRecoveryProgress,
	registerHarness,
} from "./merge-conflict-resolver-test-support.js";
import {
	builderRecoveryRequestForCandidate,
	claimPendingBuilderRecovery,
	listPendingBuilderRecoveries,
} from "./recovery-continuation.js";

vi.mock("#core/agent-harness/native-cli-egress-proxy.js", async () => {
	const actual = await vi.importActual<
		typeof import("#core/agent-harness/native-cli-egress-proxy.js")
	>("#core/agent-harness/native-cli-egress-proxy.js");
	return {
		...actual,
		startNativeCliEgressProxy: vi.fn(async () => ({
			address: { kind: "tcp" as const, port: 43_217 },
			close: async () => undefined,
		})),
	};
});

afterEach(cleanupMergeResolverFixtures);

describe("native merge-conflict recovery", () => {
	it("recovers a continued preserved claim through reconciliation and cleanup", async () => {
		const { projectDir, worktree } = makeMergeConflictFixture();
		const originalRunId = worktree.metadata.runId;
		const stalledRunId = "run-native-stalled-continuation";
		const recoveryRunId = "run-native-successful-recovery";
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
		).toMatchObject({ changed: true });
		expect(
			continueTaskClaim({
				projectDir,
				taskId: worktree.metadata.taskId,
				sourceRunId: originalRunId,
				runId: stalledRunId,
				workflowId: "builder",
				owner: "workflow:builder",
				evidence: "first continuation retained the runtime-owned merge",
			}),
		).toMatchObject({
			claimed: true,
			claim: { runId: stalledRunId, worktreeRunId: originalRunId },
		});
		expect(
			markTaskClaimPendingMerge({
				projectDir,
				taskId: worktree.metadata.taskId,
				runId: stalledRunId,
				workflowId: "builder",
				evidence: "native resolver was unavailable before daemon reload",
			}),
		).toMatchObject({ changed: true });
		const stalledRunDir = join(projectDir, ".kota/runs", stalledRunId);
		mkdirSync(stalledRunDir, { recursive: true });
		writeFileSync(
			join(stalledRunDir, "terminal-worktree-finalizer.json"),
			JSON.stringify({
				recoveryRequested: false,
				recoveryAction: { kind: "state-recovery-required" },
			}),
			"utf8",
		);

		const [candidate] = listPendingBuilderRecoveries(projectDir);
		expect(candidate).toMatchObject({
			claim: {
				runId: stalledRunId,
				worktreeRunId: originalRunId,
				status: "pending-merge",
			},
		});
		if (!candidate) throw new Error("continued pending merge was not dispatchable");
		const claimed = claimPendingBuilderRecovery({
			projectDir,
			trigger: {
				event: "autonomy.builder.recovery.requested",
				schemaRef: null,
				payload: builderRecoveryRequestForCandidate(candidate),
			},
			workflow: {
				name: "builder",
				definitionPath: "native-preserved-recovery-fixture",
				runId: recoveryRunId,
				runDir: `.kota/runs/${recoveryRunId}`,
				runDirPath: join(projectDir, ".kota/runs", recoveryRunId),
			},
		});
		expect(claimed).toMatchObject({
			claimed: true,
			recoveryPath: "continued-preserved-claim",
			claim: { runId: recoveryRunId, worktreeRunId: originalRunId },
		});

		const run = registerHarness("native", "codex");
		run.mockImplementationOnce(async (options: AgentHarnessRunOptions) => {
			options.abortQuarantine?.register(() => undefined);
			if (!options.cwd) throw new Error("native recovery fixture requires cwd");
			writeFileSync(join(options.cwd, "settings.txt"), "value=reconciled\n", "utf8");
			return {
				text: "resolved the continued native conflict",
				streamedText: "resolved the continued native conflict",
				turns: 1,
				isError: false,
			};
		});
		const selector = {
			projectDir,
			taskId: worktree.metadata.taskId,
			runId: originalRunId,
		};
		const reconciliation = await checkpointAndReconcileAutomationWorktree({
			...selector,
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
		expect(reconciliation).toMatchObject({
			phase: "ready-to-resume",
			disposition: "ready-to-resume",
			integratedCanonicalHeadCommit: canonicalHead,
			branchBehindAtResume: 0,
			validations: [{ passed: true }],
			reason: null,
		});
		const resolverAttempts = readFileSync(
			join(projectDir, ".kota/runs", recoveryRunId, "merge-conflict-resolver-attempts.jsonl"),
			"utf8",
		);
		expect(resolverAttempts).toContain("resolved the continued native conflict");

		const merged = await mergeAutomationWorktree({
			...selector,
			validationCommand: ["node", "-e", "process.exit(0)"],
			resolver: nativeMergeResolver(projectDir, recoveryRunId),
			maxResolutionAttempts: 1,
		});
		expect(merged).toMatchObject({
			status: "merged",
			reason: null,
			validation: { passed: true },
		});
		expect(
			releaseTaskClaim({
				projectDir,
				taskId: worktree.metadata.taskId,
				runId: recoveryRunId,
				workflowId: "builder",
				evidence: "native preserved recovery merged through the normal gate",
			}),
		).toMatchObject({ changed: true, recoveryStatus: "released" });
		const cleanup = cleanupAutomationWorktree(selector);
		expect(cleanup.removed).toBe(true);
		expect(existsSync(worktree.metadata.workspaceDir)).toBe(false);
		expect(readActiveTaskClaim(projectDir, worktree.metadata.taskId)).toBeNull();
		expect(listRecoveryClaims(projectDir)).toEqual([]);
		expect(readFileSync(join(projectDir, "settings.txt"), "utf8")).toBe("value=reconciled\n");
	});

	it(
		"enforces the shipped Codex boundary or preserves the merge when nested bootstrap is unavailable",
		async () => {
			const { projectDir, worktree } = makeMergeConflictFixture();
			const runId = "run-shipped-codex-sandbox";
			registerCodexAdapterFixture(codexAgentHarness, worktree.metadata.workspaceDir);

			const result = await mergeAutomationWorktree({
				projectDir,
				taskId: worktree.metadata.taskId,
				runId: worktree.metadata.runId,
				validationCommand: ["node", "-e", "process.exit(0)"],
				resolver: nativeMergeResolver(projectDir, runId),
				maxResolutionAttempts: 1,
			});

			const resolverAttempts = readFileSync(
				join(projectDir, ".kota/runs", runId, "merge-conflict-resolver-attempts.jsonl"),
				"utf8",
			);
			if (process.env.CODEX_SANDBOX) {
				expect(result).toMatchObject({ status: "pending-conflict", validation: null });
				expect(resolverAttempts).not.toContain(
					"both physical Git metadata roots denied by the Codex native sandbox",
				);
				expect(readFileSync(join(projectDir, "settings.txt"), "utf8")).toBe(
					"value=canonical\n",
				);
				return;
			}

			expect(result).toMatchObject({ status: "merged", validation: { passed: true } });
			expect(resolverAttempts).toContain(
				"both physical Git metadata roots denied by the Codex native sandbox",
			);
			expect(readFileSync(join(projectDir, "settings.txt"), "utf8")).toBe(
				"value=reconciled\n",
			);
		},
	);
});
