import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
	expectStructuredOutput,
	type TypedCodeStepInput,
	typedCodeStep,
} from "#core/workflow/step-input-code.js";
import { cleanupAutomationWorktree } from "#modules/git/worktree-lifecycle.js";
import {
	type MergeGateResult,
	mergeAutomationWorktree,
} from "#modules/git/worktree-merge-gate.js";
import type { BranchStepResult } from "./branch-per-task.js";
import {
	createMergeConflictResolver,
	MERGE_CONFLICT_RESOLUTION_ATTEMPTS,
} from "./merge-conflict-resolver.js";
import type { BuilderWorkspaceResult } from "./prepare-worktree-step.js";

export type AutomationWorktreeCleanupResult = {
	removed: boolean;
	workspaceDir: string | null;
	state: string | null;
	blockers: string[];
};

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
			return workspace?.enabled === true && branch?.branchPerTask === true && commit?.committed === true;
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
		run: async (ctx) => {
			const workspace = preparedWorktree(ctx);
			if (!workspace?.taskId) throw new Error("Cannot run merge gate without a prepared task worktree");
			const buildResult = ctx.stepResults.build;
			return await mergeAutomationWorktree({
				projectDir: ctx.projectDir,
				taskId: workspace.taskId,
				runId: ctx.workflow.runId,
				validationCommand: MERGE_GATE_VALIDATION_COMMAND,
				resolver: createMergeConflictResolver({
					runDirPath: ctx.workflow.runDirPath,
					workflowName: ctx.workflow.name,
					runId: ctx.workflow.runId,
					harnessName: buildResult?.harness,
					model: buildResult?.model,
				}),
				maxResolutionAttempts: MERGE_CONFLICT_RESOLUTION_ATTEMPTS,
			});
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
				"state",
				"blockers",
			]),
		run: (ctx) => {
			const workspace = preparedWorktree(ctx);
			if (!workspace?.taskId) throw new Error("Cannot cleanup automation worktree without a prepared task id");
			const result = cleanupAutomationWorktree({
				projectDir: ctx.projectDir,
				taskId: workspace.taskId,
				runId: ctx.workflow.runId,
			});
			return {
				removed: result.removed,
				workspaceDir: result.inspection.metadata.workspaceDir,
				state: result.inspection.metadata.state,
				blockers: result.inspection.cleanup.blockers,
			};
		},
	});
}
