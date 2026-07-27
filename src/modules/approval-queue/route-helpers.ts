import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type ApprovalClientProjection,
	type ApprovalExecutionApproveAllResult,
	type ApprovalQueue,
	type ApprovalStatus,
	getApprovalQueue,
	isApprovalId,
	type PendingApproval,
	projectApprovalForClient,
} from "#core/daemon/approval-queue.js";
import {
	DAEMON_PROJECT_SCOPE_PROVIDER_TYPE,
	type DaemonProjectRuntimeScope,
} from "#core/daemon/project-scope-provider.js";
import { redactSensitiveText } from "#core/evidence/policy.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { readSelectedScopeSelectorIdQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
	type ApprovalExecutionLease,
	approveAllResponse,
	approvedApprovalResponse,
	closeApprovalExecutionLeases,
	prepareApprovalExecutionBatch,
} from "./approval-execution.js";

type OptionalStringFieldRead =
	| { ok: true; value?: string }
	| { ok: false };

const VALID_STATUSES: readonly (ApprovalStatus | "all")[] = [
	"all",
	"pending",
	"approved",
	"rejected",
	"expired",
];

export function readStatusFilter(req: IncomingMessage): ApprovalStatus | "all" | undefined {
	const status = new URL(req.url ?? "", "http://localhost").searchParams.get("status");
	if (status === null) return undefined;
	if ((VALID_STATUSES as readonly string[]).includes(status)) {
		return status as ApprovalStatus | "all";
	}
	return undefined;
}

export function readProjectId(
	req: IncomingMessage,
	res: ServerResponse,
): string | null | undefined {
	return readSelectedScopeSelectorIdQueryOrErrorResponse(req, res);
}

export function approvalQuery(
	status?: ApprovalStatus | "all",
	projectId?: string,
): string {
	const params = new URLSearchParams();
	if (status) params.set("status", status);
	if (projectId) params.set("projectId", projectId);
	const query = params.toString();
	return query ? `?${query}` : "";
}

export function projectQuery(projectId?: string): string {
	if (!projectId) return "";
	const params = new URLSearchParams();
	params.set("projectId", projectId);
	return `?${params.toString()}`;
}

export function resolveApprovalQueue(
	res: ServerResponse,
	queue?: ApprovalQueue,
	projectId?: string,
): { queue: ApprovalQueue; executionContext?: ToolRunnerContext } | null {
	if (queue) return { queue };
	const projectScope = getProviderRegistry()?.get(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
	if (!projectScope) {
		if (projectId) {
			jsonResponse(res, 404, {
				error: "Unknown project",
				reason: "unknown_project",
				projectId,
			});
			return null;
		}
		return { queue: getApprovalQueue() };
	}
	const resolved = projectScope.resolveProjectRuntime(projectId);
	if (!resolved.ok) {
		jsonResponse(res, 404, resolved.error);
		return null;
	}
	return {
		queue: resolved.runtime.approvalQueue,
		executionContext: projectExecutionContext(resolved.runtime),
	};
}

export function listApprovalsLocal(
	queue: ApprovalQueue,
	status?: ApprovalStatus | "all",
): { approvals: ApprovalClientProjection[] } {
	if (status === undefined) {
		return { approvals: queue.list("pending").map((item) => projectApprovalForClient(item)) };
	}
	if (status === "all") {
		return { approvals: queue.list().map((item) => projectApprovalForClient(item)) };
	}
	return { approvals: queue.list(status).map((item) => projectApprovalForClient(item)) };
}

export function rejectApprovalLocal(
	queue: ApprovalQueue,
	id: string,
	reason?: string,
): PendingApproval | null {
	return queue.reject(id, reason);
}

export function rejectAllApprovalsLocal(
	queue: ApprovalQueue,
	reason?: string,
): { approvals: ApprovalClientProjection[]; count: number } {
	const items = queue.rejectAll(reason);
	return { approvals: items.map((item) => projectApprovalForClient(item)), count: items.length };
}

export function rejectMalformedApprovalId(res: ServerResponse, id: string): boolean {
	if (isApprovalId(id)) return false;
	jsonResponse(res, 400, {
		error: "Invalid approval id",
		reason: "invalid_approval_id",
		id,
	});
	return true;
}

export function writeApprovalInputUnavailable(
	res: ServerResponse,
	approvals: PendingApproval[],
): void {
	jsonResponse(res, 409, {
		error: "Approval input is unavailable after daemon restart",
		reason: "approval_input_unavailable",
		approvals: approvals.map((item) => projectApprovalForClient(item)),
	});
}

export function writeApprovalScopeMismatch(
	res: ServerResponse,
	expectedScopeId: string,
	approvals: PendingApproval[],
): void {
	jsonResponse(res, 409, {
		error: "Approval belongs to a different project scope",
		reason: "approval_scope_mismatch",
		expectedScopeId,
		approvals: approvals.map((item) => projectApprovalForClient(item)),
	});
}

export async function readOptionalStringField(
	req: IncomingMessage,
	res: ServerResponse,
	field: "note" | "reason",
): Promise<OptionalStringFieldRead> {
	try {
		const body = await readBody(req);
		const value = body[field];
		return { ok: true, ...(typeof value === "string" ? { value } : {}) };
	} catch {
		jsonResponse(res, 400, { error: "Invalid request body" });
		return { ok: false };
	}
}

export async function proxyApprovalMutation(
	res: ServerResponse,
	link: DaemonTransport,
	path: string,
	body: { note?: string } | { reason?: string },
): Promise<void> {
	try {
		const upstream = await link.fetchRaw(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const payload = await upstream.json();
		jsonResponse(res, upstream.status, payload);
	} catch (err) {
		jsonResponse(res, 502, {
			error: "Approval mutation proxy failed",
			reason: "daemon_transport_failed",
			message: redactSensitiveText(err instanceof Error ? err.message : String(err)),
		});
	}
}

export async function writeApproveApprovalMutation(
	res: ServerResponse,
	queue: ApprovalQueue,
	id: string,
	note: string | undefined,
	executionContext: ToolRunnerContext | undefined,
): Promise<void> {
	const pending = queue.get(id);
	const selectedScopeId = executionContext?.scopeId ?? queue.getScopeId();
	if (
		queue.getScopeId() !== selectedScopeId ||
		(pending?.status === "pending" && pending.scopeId !== selectedScopeId)
	) {
		writeApprovalScopeMismatch(res, selectedScopeId, pending ? [pending] : []);
		return;
	}
	let leases: Map<string, ApprovalExecutionLease> | undefined;
	if (pending?.status === "pending") {
		const preflight = await prepareApprovalExecutionBatch([pending], executionContext);
		if (!preflight.ok) {
			jsonResponse(res, preflight.status, preflight.body);
			return;
		}
		leases = preflight.leases;
	}
	const result = queue.approveForExecution(id, note);
	if (!result.ok && result.reason === "not_found") {
		if (leases) await closeApprovalExecutionLeases(leases.values());
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
		return;
	}
	if (!result.ok && result.reason === "scope_mismatch") {
		if (leases) await closeApprovalExecutionLeases(leases.values());
		writeApprovalScopeMismatch(
			res,
			selectedScopeId,
			result.approval ? [result.approval] : [],
		);
		return;
	}
	if (!result.ok) {
		if (leases) await closeApprovalExecutionLeases(leases.values());
		writeApprovalInputUnavailable(res, result.approval ? [result.approval] : []);
		return;
	}
	try {
		jsonResponse(res, 200, await approvedApprovalResponse(
			result.approval,
			executionContext,
			leases?.get(result.approval.id),
		));
	} finally {
		if (leases) await closeApprovalExecutionLeases(leases.values());
	}
}

export async function writeApproveAllApprovalsMutation(
	res: ServerResponse,
	queue: ApprovalQueue,
	note: string | undefined,
	executionContext: ToolRunnerContext | undefined,
): Promise<void> {
	const pendingApprovals = queue.list("pending");
	const selectedScopeId = executionContext?.scopeId ?? queue.getScopeId();
	const mismatched = pendingApprovals.filter(
		(item) => item.scopeId !== selectedScopeId,
	);
	if (queue.getScopeId() !== selectedScopeId || mismatched.length > 0) {
		writeApprovalScopeMismatch(res, selectedScopeId, mismatched);
		return;
	}
	const pendingApprovalIds = pendingApprovals.map((item) => item.id);
	const preflight = await prepareApprovalExecutionBatch(pendingApprovals, executionContext);
	if (!preflight.ok) {
		jsonResponse(res, preflight.status, preflight.body);
		return;
	}
	const result = approveAllApprovalsLocal(queue, pendingApprovalIds, note);
	if (!result.ok) {
		await closeApprovalExecutionLeases(preflight.leases.values());
		if (result.reason === "scope_mismatch") {
			writeApprovalScopeMismatch(res, selectedScopeId, result.approvals);
			return;
		}
		writeApprovalInputUnavailable(res, result.approvals);
		return;
	}
	try {
		jsonResponse(res, 200, await approveAllResponse(
			result.approvals,
			executionContext,
			preflight.leases,
		));
	} finally {
		await closeApprovalExecutionLeases(preflight.leases.values());
	}
}

function approveAllApprovalsLocal(
	queue: ApprovalQueue,
	approvalIds: readonly string[],
	note?: string,
): ApprovalExecutionApproveAllResult {
	return queue.approvePendingForExecution(approvalIds, note);
}

function projectExecutionContext(
	runtime: DaemonProjectRuntimeScope,
): ToolRunnerContext {
	return {
		scopeId: runtime.project.projectId,
		projectId: runtime.project.projectId,
		cwd: runtime.project.projectDir,
	};
}
