import { loadConfig } from "#core/config/config.js";
import { beginApprovalExecutionActivity } from "#core/daemon/approval-execution-activity.js";
import {
	type ApprovalQueue,
	defaultApprovalPendingTtlMs,
	getApprovalQueue,
	isApprovalId,
} from "#core/daemon/approval-queue.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
	type ScopeSelector,
	selectedScopeSelectorId,
} from "#core/server/scope-selector.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
	ApprovalExecutionDescriptorMismatchError,
	approvedApprovalResponse,
	prepareApprovalExecutionBatch,
	withApprovalExecutionLeases,
} from "./approval-execution.js";
import type {
	ApprovalApproveResult,
	ApprovalListFilter,
	ApprovalRejectResult,
	ApprovalScopeSelection,
	ApprovalsClient,
} from "./client.js";

type LocalApprovalTarget = {
	queue: ApprovalQueue;
	executionContext?: ToolRunnerContext;
};

function resolveLocalApprovalTarget(selector?: ScopeSelector): LocalApprovalTarget {
	const scopeProvider = getProviderRegistry()?.get(DAEMON_SCOPE_PROVIDER_TYPE);
	const scopeId = selectedScopeSelectorId(selector);
	if (!scopeProvider) {
		if (scopeId) throw new Error(`Unknown scope: ${scopeId}`);
		return { queue: getApprovalQueue() };
	}
	const resolved = scopeProvider.resolveScopeRuntime(scopeId);
	if (!resolved.ok) {
		throw new Error(`Unknown scope: ${resolved.error.scopeId}`);
	}
	return {
		queue: resolved.runtime.approvalQueue,
		executionContext: {
			scopeId: resolved.runtime.scope.scopeId,
			scopeRoot: resolved.runtime.scope.scopeRoot,
			cwd: resolved.runtime.scope.scopeRoot,
		},
	};
}

function listLocalApprovals(filter?: ApprovalListFilter) {
	const config = loadConfig();
	const ttlMs = config.approvalTtlMs ?? defaultApprovalPendingTtlMs();
	const { queue } = resolveLocalApprovalTarget(filter);
	queue.expireStale(ttlMs);
	const status = filter?.status;
	if (status === undefined) {
		return { approvals: queue.list("pending").map((item) => queue.projectForClient(item)) };
	}
	if (status === "all") {
		return { approvals: queue.list().map((item) => queue.projectForClient(item)) };
	}
	return { approvals: queue.list(status).map((item) => queue.projectForClient(item)) };
}

function failedApprovalMutation(
	reason: "not_found" | "input_unavailable" | "scope_mismatch" | "descriptor_mismatch",
): ApprovalApproveResult | ApprovalRejectResult {
	return {
		ok: false,
		reason: reason === "descriptor_mismatch" ? "review_mismatch" : reason,
	};
}

async function approveLocalApproval(
	id: string,
	reviewDigest: string,
	note?: string,
	scopeSelector?: ApprovalScopeSelection,
): Promise<ApprovalApproveResult> {
	if (!isApprovalId(id)) return { ok: false, reason: "invalid_id" };
	const { queue, executionContext } = resolveLocalApprovalTarget(scopeSelector);
	const selection = queue.getExecutionSnapshot(id);
	if (!selection.ok) return failedApprovalMutation(selection.reason) as ApprovalApproveResult;
	if (selection.snapshot.descriptor.reviewDigest !== reviewDigest) {
		return { ok: false, reason: "review_mismatch" };
	}
	const releaseExecution = beginApprovalExecutionActivity(queue, [id]);
	try {
		const preflight = await prepareApprovalExecutionBatch(
			[selection.snapshot],
			executionContext,
		);
		if (!preflight.ok) throw new Error(preflight.body.error);

		return await withApprovalExecutionLeases(preflight.leases.values(), async () => {
			const lease = preflight.leases.get(id);
			if (lease === undefined) return { ok: false, reason: "review_mismatch" };
			const result = queue.approveForExecution(lease, note);
			if (!result.ok) {
				return failedApprovalMutation(result.reason) as ApprovalApproveResult;
			}
			try {
				return {
					ok: true,
					...await approvedApprovalResponse(
						result.approval,
						executionContext,
						lease,
					),
				};
			} catch (error) {
				if (!(error instanceof ApprovalExecutionDescriptorMismatchError)) throw error;
				return { ok: false, reason: "review_mismatch" };
			}
		});
	} finally {
		releaseExecution();
	}
}

export function buildLocalApprovalsClient(): ApprovalsClient {
	return {
		async list(filter) {
			return listLocalApprovals(filter);
		},
		approve: approveLocalApproval,
		async reject(id, reason, scopeSelector) {
			if (!isApprovalId(id)) return { ok: false, reason: "invalid_id" };
			const item = resolveLocalApprovalTarget(scopeSelector).queue.reject(id, reason);
			return item ? { ok: true, approval: item } : { ok: false, reason: "not_found" };
		},
	};
}
