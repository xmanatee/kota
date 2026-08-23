import {
	composeCanUseTools,
	createWorkflowAgentGuards,
	hasAgentHarness,
	resolveAgentHarness,
	shouldRouteKotaToolControl,
} from "#core/agent-harness/index.js";
import type { AgentRuntimeSelection } from "#core/model/preset.js";
import type { WorkflowAgentHarnessRunner } from "#core/workflow/run-types.js";
import type { WorkflowAgentRunContractSpec } from "#core/workflow/step-types.js";
import { resolveWorkflowAgentRunContract } from "#core/workflow/steps/step-executor-agent-run-contract.js";
import { AUTONOMY_DISALLOWED_TOOLS } from "#modules/autonomy/shared.js";
import type { MergeGateResolver } from "#modules/git/worktree-merge-gate.js";
import { hasConcreteTaskAcceptanceEvidence } from "#modules/repo-tasks/repo-tasks-domain.js";
import { reviewMergeConflictResolution } from "./merge-conflict-resolution-review.js";
import {
	appendMergeConflictResolverAttempt,
	conflictPathSet,
	createMergeConflictResolverToolGuard,
	MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS,
	MERGE_CONFLICT_RESOLVER_SYSTEM_PROMPT,
	mergeConflictResolverPrompt,
} from "./merge-conflict-resolver-support.js";
import { loadMergeConflictTaskContract } from "./merge-conflict-task-contract.js";

export {
	createMergeConflictResolverToolGuard,
	MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS,
} from "./merge-conflict-resolver-support.js";

export const MERGE_CONFLICT_RESOLUTION_ATTEMPTS = 2;

const MERGE_CONFLICT_RESOLVER_MAX_TURNS = 8;
const ARTIFACT_TRANSCRIPT_LIMIT = 8_000;
const MISSING_TASK_CONTRACT_SUBTYPE = "missing-task-contract";
const MISSING_ACCEPTANCE_EVIDENCE_SUBTYPE = "missing-acceptance-evidence";

export type MergeConflictResolverOptions = {
	runDirPath: string;
	workflowName: string;
	runId: string;
	agentContract: WorkflowAgentRunContractSpec;
	runAgentHarness: WorkflowAgentHarnessRunner;
	signal?: AbortSignal;
};

export function resolveMergeConflictResolverRunContract(
	runtime: AgentRuntimeSelection,
): WorkflowAgentRunContractSpec {
	const harness = hasAgentHarness(runtime.harness)
		? resolveAgentHarness(runtime.harness)
		: undefined;
	return {
		harness: runtime.harness,
		model: runtime.tiers.capable,
		effort: runtime.effort,
		maxTurns: MERGE_CONFLICT_RESOLVER_MAX_TURNS,
		autonomyMode: "autonomous",
		ownerQuestionAccess: "disabled",
		...(harness && shouldRouteKotaToolControl(harness)
			? {
				allowedTools: [...MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS],
				disallowedTools: AUTONOMY_DISALLOWED_TOOLS,
			}
			: {}),
	};
}

export function createMergeConflictResolver(options: MergeConflictResolverOptions): MergeGateResolver {
	return async (request) => {
		const harness = resolveAgentHarness(options.agentContract.harness);
		const taskResult = loadMergeConflictTaskContract({
			workspaceDir: request.workspaceDir,
			taskId: request.taskId,
			revision: request.baseCommit,
		});
		if (!taskResult.found) {
			const summary =
				`Merge-conflict resolver could not bind claimed task contract ${request.taskId} ` +
				`to original base ${request.baseCommit}: ${taskResult.reason}.`;
			appendMergeConflictResolverAttempt(options, request, {
				resolved: false,
				summary,
				isError: false,
				subtype: MISSING_TASK_CONTRACT_SUBTYPE,
			});
			return { resolved: false, summary };
		}
		const task = taskResult.task;
		if (!hasConcreteTaskAcceptanceEvidence(task.content)) {
			const summary =
				`Merge-conflict resolver rejected task ${request.taskId} because its acceptance ` +
				"evidence is missing or placeholder-only.";
			appendMergeConflictResolverAttempt(options, request, {
				resolved: false,
				summary,
				isError: false,
				subtype: MISSING_ACCEPTANCE_EVIDENCE_SUBTYPE,
				taskState: task.state,
			});
			return { resolved: false, summary };
		}

		const writeScope = [...conflictPathSet(request)];
		const resolved = resolveWorkflowAgentRunContract({
			step: options.agentContract,
			harness,
			model: options.agentContract.model,
			prompt: mergeConflictResolverPrompt(request, task),
			canUseTool: composeCanUseTools(
				createWorkflowAgentGuards(),
				createMergeConflictResolverToolGuard(request),
			),
			askOwnerSource: `merge-conflict-resolver:${options.workflowName}/${options.runId}`,
		});
		let transcript = "";
		const response = await options.runAgentHarness(
			harness,
			{
				...resolved.options,
				cwd: request.workspaceDir,
				agentWriteScope: writeScope,
				systemPrompt: MERGE_CONFLICT_RESOLVER_SYSTEM_PROMPT,
			},
			{
				signal: options.signal,
				workspaceKey: request.workspaceDir,
				writer: {
					write: (text) => {
						transcript = (transcript + text).slice(-ARTIFACT_TRANSCRIPT_LIMIT);
						return true;
					},
				},
			},
		);
		const summary = response.text.trim() || response.subtype || "merge resolver produced no summary";
		if (response.isError) {
			appendMergeConflictResolverAttempt(options, request, {
				resolved: false,
				summary,
				isError: true,
				taskState: task.state,
				transcript: transcript || response.text,
				...(response.subtype !== undefined ? { subtype: response.subtype } : {}),
			});
			return { resolved: false, summary };
		}
		const review = await reviewMergeConflictResolution({
			request,
			task,
			resolutionSummary: summary,
			harness,
			agentContract: options.agentContract,
			runAgentHarness: options.runAgentHarness,
			...(options.signal !== undefined ? { signal: options.signal } : {}),
		});
		const result = {
			resolved: review.approved,
			summary: review.summary,
			isError: false,
			taskState: task.state,
			transcript: transcript || response.text,
			reviewTranscript: review.transcript,
			resolvedDiff: review.resolvedDiff,
			...(review.judgment !== undefined
				? { taskScopeJudgment: review.judgment }
				: {}),
			...(review.subtype !== undefined ? { subtype: review.subtype } : {}),
		};
		appendMergeConflictResolverAttempt(options, request, result);
		return {
			resolved: result.resolved,
			summary: result.summary,
			...(review.subtype === "semantic-resolution-needs-review" &&
				review.judgment?.verdict === "needs-review"
				? {
					reviewFeedback: {
						summary: review.judgment.summary,
						taskScopeJustification: review.judgment.taskScopeJustification,
						pathJudgments: review.judgment.pathJudgments,
					},
				}
				: {}),
		};
	};
}
