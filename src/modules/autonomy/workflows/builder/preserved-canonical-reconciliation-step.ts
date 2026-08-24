import { join } from "node:path";
import {
	type WorkflowBlockingStepContext,
	withWorkflowBlockingOperation,
} from "#core/workflow/blocking-operation-context.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
	expectStructuredOutput,
	type TypedCodeStepInput,
	typedCodeStep,
} from "#core/workflow/step-input-code.js";
import { checkpointAndReconcileAutomationWorktree } from "#modules/git/worktree-canonical-reconciliation.js";
import type {
	AutomationWorktreeCanonicalReconciliation,
} from "#modules/git/worktree-lifecycle-types.js";
import {
	createMergeConflictResolver,
	MERGE_CONFLICT_RESOLUTION_ATTEMPTS,
	resolveMergeConflictResolverRunContract,
} from "./merge-conflict-resolver.js";
import type { BuilderWorkspaceResult } from "./prepare-worktree-step.js";
import { persistPreservedCanonicalReconciliationOperation } from "./preserved-canonical-reconciliation-operations.js";
import { BUILDER_RECOVERY_EVENT } from "./recovery-continuation.js";
import { markBuilderTaskClaimPendingMergeOperation } from "./task-claim-operations.js";

const RECOVERY_VALIDATION_COMMANDS = [
	["pnpm", "run", "validate-tasks"],
	["pnpm", "run", "typecheck"],
] as const;

export const PRESERVED_CANONICAL_RECONCILIATION_STEP_ID =
	"reconcile-preserved-canonical";

type PreservedReconciliationPolicy = {
	artifactName: string;
	validationCommands: readonly (readonly string[])[];
	needsReviewClaimDisposition: "pending-merge" | "retain-active";
};

function preparedWorktree(
	ctx: Pick<WorkflowStepContext, "stepOutputs">,
): BuilderWorkspaceResult | undefined {
	return ctx.stepOutputs["prepare-worktree"] as BuilderWorkspaceResult | undefined;
}

export async function reconcilePreservedBuilderWorkspace(
	ctx: WorkflowBlockingStepContext,
	workspace: BuilderWorkspaceResult & {
		taskId: string;
	},
	policy: PreservedReconciliationPolicy,
): Promise<AutomationWorktreeCanonicalReconciliation> {
	if (workspace.enabled !== true) {
		throw new Error(
			"Builder continuation cannot preserve-yield without an isolated task worktree",
		);
	}
	const worktreeRunId = workspace.worktreeRunId ?? ctx.workflow.runId;
	const result = await checkpointAndReconcileAutomationWorktree(
		{
			projectDir: ctx.projectDir,
			taskId: workspace.taskId,
			runId: worktreeRunId,
			recoveryRunId: ctx.workflow.runId,
			artifactPath: join(ctx.workflow.runDirPath, policy.artifactName),
			validationCommands: policy.validationCommands,
			resolver: createMergeConflictResolver({
				runDirPath: ctx.workflow.runDirPath,
				workflowName: ctx.workflow.name,
				runId: ctx.workflow.runId,
				agentContract: resolveMergeConflictResolverRunContract(
					ctx.agentRuntime,
				),
				runAgentHarness: ctx.runAgentHarness,
				signal: ctx.signal,
			}),
			maxResolutionAttempts: MERGE_CONFLICT_RESOLUTION_ATTEMPTS,
			signal: ctx.signal,
			onProgress: (record) =>
				ctx.runBlocking(persistPreservedCanonicalReconciliationOperation, {
					projectDir: ctx.projectDir,
					taskId: workspace.taskId,
					worktreeRunId,
					recoveryRunId: ctx.workflow.runId,
					workflowId: ctx.workflow.name,
					record,
				}),
		},
		ctx,
	);
	if (
		result.disposition === "needs-review" &&
		policy.needsReviewClaimDisposition === "pending-merge"
	) {
		const pending = await ctx.runBlocking(
			markBuilderTaskClaimPendingMergeOperation,
			{
				projectDir: ctx.projectDir,
				taskId: workspace.taskId,
				runId: ctx.workflow.runId,
				workflowId: ctx.workflow.name,
				evidence:
					`preserved canonical reconciliation needs review: ${result.reason ?? "unclassified conflict"}`,
			},
		);
		if (!pending.changed) {
			throw new Error(
				pending.reason ??
					`Could not hold task claim ${workspace.taskId} for canonical reconciliation review`,
			);
		}
	}
	return result;
}

export function preservedCanonicalReconciliationReady(
	ctx: Pick<WorkflowStepContext, "trigger" | "stepOutputs">,
): boolean {
	if (ctx.trigger.event !== BUILDER_RECOVERY_EVENT) return true;
	const result = ctx.stepOutputs[PRESERVED_CANONICAL_RECONCILIATION_STEP_ID] as
		| AutomationWorktreeCanonicalReconciliation
		| undefined;
	return result?.disposition === "ready-to-resume";
}

export function createPreservedCanonicalReconciliationStep(): TypedCodeStepInput<AutomationWorktreeCanonicalReconciliation> {
	return typedCodeStep<AutomationWorktreeCanonicalReconciliation>({
		id: PRESERVED_CANONICAL_RECONCILIATION_STEP_ID,
		type: "code",
		when: (ctx) => {
			if (ctx.trigger.event !== BUILDER_RECOVERY_EVENT) return false;
			const workspace = preparedWorktree(ctx);
			return (
				workspace?.enabled === true &&
				typeof workspace.taskId === "string" &&
				typeof workspace.worktreeRunId === "string"
			);
		},
		validate: (raw) =>
			expectStructuredOutput<AutomationWorktreeCanonicalReconciliation>(raw, [
				"phase",
				"disposition",
				"originalBaseCommit",
				"checkpointCommit",
				"canonicalHeadCommit",
				"integratedCanonicalHeadCommit",
				"conflicts",
				"validations",
				"artifactPath",
			]),
		resolveAgentContract: resolveMergeConflictResolverRunContract,
		run: async (ctx) => {
			const workspace = preparedWorktree(ctx);
			if (
				workspace?.enabled !== true ||
				typeof workspace.taskId !== "string" ||
				typeof workspace.worktreeRunId !== "string"
			) {
				throw new Error(
					"Preserved canonical reconciliation requires the continued task worktree",
				);
			}
			const continuedWorkspace = workspace as BuilderWorkspaceResult & {
				taskId: string;
			};
				return reconcilePreservedBuilderWorkspace(
					withWorkflowBlockingOperation(ctx),
					continuedWorkspace,
					{
						artifactName: "preserved-canonical-reconciliation.json",
						validationCommands: RECOVERY_VALIDATION_COMMANDS,
						needsReviewClaimDisposition: "pending-merge",
					},
				);
		},
	});
}
