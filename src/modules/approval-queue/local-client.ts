import { loadConfig } from "#core/config/config.js";
import {
	type ApprovalQueue,
	defaultApprovalPendingTtlMs,
	getApprovalQueue,
	isApprovalId,
} from "#core/daemon/approval-queue.js";
import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
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
	ApprovalListFilter,
	ApprovalMutateResult,
	ApprovalProjectScope,
	ApprovalsClient,
} from "./client.js";

type LocalApprovalTarget = {
	queue: ApprovalQueue;
	executionContext?: ToolRunnerContext;
};

function resolveLocalApprovalTarget(selector?: ScopeSelector): LocalApprovalTarget {
	const projectScope = getProviderRegistry()?.get(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
	const projectId = selectedScopeSelectorId(selector);
	if (!projectScope) {
		if (projectId) throw new Error(`Unknown project: ${projectId}`);
		return { queue: getApprovalQueue() };
	}
	const resolved = projectScope.resolveProjectRuntime(projectId);
	if (!resolved.ok) {
		throw new Error(`Unknown project: ${resolved.error.projectId}`);
	}
	return {
		queue: resolved.runtime.approvalQueue,
		executionContext: {
			scopeId: resolved.runtime.project.projectId,
			projectId: resolved.runtime.project.projectId,
			cwd: resolved.runtime.project.projectDir,
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
): ApprovalMutateResult {
	return {
		ok: false,
		reason: reason === "descriptor_mismatch" ? "review_mismatch" : reason,
	};
}

async function approveLocalApproval(
	id: string,
	reviewDigest: string,
	note?: string,
	project?: ApprovalProjectScope,
): Promise<ApprovalMutateResult> {
	if (!isApprovalId(id)) return { ok: false, reason: "invalid_id" };
	const { queue, executionContext } = resolveLocalApprovalTarget(project);
	const selection = queue.getExecutionSnapshot(id);
	if (!selection.ok) return failedApprovalMutation(selection.reason);
	if (selection.snapshot.descriptor.reviewDigest !== reviewDigest) {
		return { ok: false, reason: "review_mismatch" };
	}
	const preflight = await prepareApprovalExecutionBatch(
		[selection.snapshot],
		executionContext,
	);
	if (!preflight.ok) throw new Error(preflight.body.error);

	return withApprovalExecutionLeases(preflight.leases.values(), async () => {
		const lease = preflight.leases.get(id);
		if (lease === undefined) return { ok: false, reason: "review_mismatch" };
		const result = queue.approveForExecution(lease, note);
		if (!result.ok) return failedApprovalMutation(result.reason);
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
}

export function buildLocalApprovalsClient(): ApprovalsClient {
	return {
		async list(filter) {
			return listLocalApprovals(filter);
		},
		approve: approveLocalApproval,
		async reject(id, reason, project) {
			if (!isApprovalId(id)) return { ok: false, reason: "invalid_id" };
			const item = resolveLocalApprovalTarget(project).queue.reject(id, reason);
			return item ? { ok: true, approval: item } : { ok: false, reason: "not_found" };
		},
	};
}
