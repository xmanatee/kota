import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
	expectStructuredOutput,
	type TypedCodeStepInput,
	typedCodeStep,
} from "#core/workflow/step-input-code.js";
import {
	type MergeGateResult,
	mergeAutomationWorktree,
} from "#modules/git/worktree-merge-gate.js";
import type { BranchStepResult } from "./branch-per-task.js";
import { claimedTaskConsistencySucceeded } from "./claimed-task-consistency-step.js";
import {
	createMergeConflictResolver,
	MERGE_CONFLICT_RESOLUTION_ATTEMPTS,
	resolveMergeConflictResolverRunContract,
} from "./merge-conflict-resolver.js";
import {
	type AutomationWorktreeCleanupResult,
	cleanupAutomationWorktreeOperation,
} from "./merge-gate-operations.js";
import type { BuilderWorkspaceResult } from "./prepare-worktree-step.js";
import { builderWorktreeRunId } from "./workspace.js";

const MERGE_GATE_VALIDATION_COMMAND = [
	"pnpm",
	"test",
	"src/modules/git",
	"src/modules/autonomy/workflows/builder",
];

function preparedWorktree(ctx: Pick<WorkflowStepContext, "stepOutputs">): BuilderWorkspaceResult | undefined {
	return ctx.stepOutputs["prepare-worktree"] as BuilderWorkspaceResult | undefined;
}

function taskBranch(ctx: Pick<WorkflowStepContext, "stepOutputs">): BranchStepResult | undefined {
	return ctx.stepOutputs["create-task-branch"] as BranchStepResult | undefined;
}

export function mergeGateSucceeded(ctx: Pick<WorkflowStepContext, "stepOutputs">): boolean {
	const result = ctx.stepOutputs["merge-gate"] as MergeGateResult | undefined;
	return result?.status === "merged";
}

export function mergeGatePending(ctx: Pick<WorkflowStepContext, "stepOutputs">): MergeGateResult | undefined {
	const result = ctx.stepOutputs["merge-gate"] as MergeGateResult | undefined;
	return result && result.status !== "merged" ? result : undefined;
}

export function createMergeGateStep(): TypedCodeStepInput<MergeGateResult> {
	return typedCodeStep<MergeGateResult>({
		id: "merge-gate",
		type: "code",
		when: (ctx) => {
			const workspace = preparedWorktree(ctx);
			const branch = taskBranch(ctx);
			const commit = ctx.stepOutputs.commit as { committed?: boolean } | undefined;
			return (
				claimedTaskConsistencySucceeded(ctx) &&
				workspace?.enabled === true &&
				branch?.branchPerTask === true &&
				commit?.committed === true
			);
		},
		validate: (raw) =>
			expectStructuredOutput<MergeGateResult>(raw, [
				"status",
				"taskId",
				"runId",
				"branch",
				"baseCommit",
				"canonicalHeadCommit",
				"headCommit",
				"conflicts",
				"artifactPath",
			]),
		resolveAgentContract: resolveMergeConflictResolverRunContract,
		run: async (ctx) => {
			const workspace = preparedWorktree(ctx);
			if (!workspace?.taskId) throw new Error("Cannot run merge gate without a prepared task worktree");
			return await mergeAutomationWorktree(
				{
					projectDir: ctx.projectDir,
					taskId: workspace.taskId,
					runId: builderWorktreeRunId(ctx),
					validationCommand: MERGE_GATE_VALIDATION_COMMAND,
					resolver: createMergeConflictResolver({
						runDirPath: ctx.workflow.runDirPath,
						workflowName: ctx.workflow.name,
						runId: ctx.workflow.runId,
						agentContract: resolveMergeConflictResolverRunContract(ctx.agentRuntime),
						runAgentHarness: ctx.runAgentHarness,
						signal: ctx.signal,
					}),
					maxResolutionAttempts: MERGE_CONFLICT_RESOLUTION_ATTEMPTS,
				},
				ctx,
			);
		},
	});
}

export function createCleanupAutomationWorktreeStep(): TypedCodeStepInput<AutomationWorktreeCleanupResult> {
	return typedCodeStep<AutomationWorktreeCleanupResult>({
		id: "cleanup-automation-worktree",
		type: "code",
		when: mergeGateSucceeded,
		validate: (raw) =>
			expectStructuredOutput<AutomationWorktreeCleanupResult>(raw, [
				"removed",
				"workspaceDir",
				"metadataPath",
				"artifactPath",
				"state",
				"cleanupEligible",
				"blockers",
			]),
		run: (ctx) => {
			const workspace = preparedWorktree(ctx);
			if (!workspace?.taskId) throw new Error("Cannot cleanup automation worktree without a prepared task id");
			return ctx.runBlocking(cleanupAutomationWorktreeOperation, {
				projectDir: ctx.projectDir,
				taskId: workspace.taskId,
				runId: builderWorktreeRunId(ctx),
				runDirPath: ctx.workflow.runDirPath,
			});
		},
	});
}
