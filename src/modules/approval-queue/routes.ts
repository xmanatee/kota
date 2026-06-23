import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type ApprovalClientProjection,
	type ApprovalExecutionApprovalResult,
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
import type {
	ControlRouteRegistration,
	RouteRegistration,
} from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
	type DaemonTransport,
	getDaemonTransport,
} from "#core/server/daemon-transport.js";
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

function readStatusFilter(req: IncomingMessage): ApprovalStatus | "all" | undefined {
	const status = new URL(req.url ?? "", "http://localhost").searchParams.get("status");
	if (status === null) return undefined;
	if ((VALID_STATUSES as readonly string[]).includes(status)) {
		return status as ApprovalStatus | "all";
	}
	return undefined;
}

function readProjectId(
	req: IncomingMessage,
	res: ServerResponse,
): string | null | undefined {
	return readSelectedScopeSelectorIdQueryOrErrorResponse(req, res);
}

function approvalQuery(
	status?: ApprovalStatus | "all",
	projectId?: string,
): string {
	const params = new URLSearchParams();
	if (status) params.set("status", status);
	if (projectId) params.set("projectId", projectId);
	const query = params.toString();
	return query ? `?${query}` : "";
}

function projectQuery(projectId?: string): string {
	if (!projectId) return "";
	const params = new URLSearchParams();
	params.set("projectId", projectId);
	return `?${params.toString()}`;
}

function resolveApprovalQueue(
	res: ServerResponse,
	queue?: ApprovalQueue,
	projectId?: string,
): { queue: ApprovalQueue; executionContext?: ToolRunnerContext } | null {
	if (queue) return { queue };
	const projectScope = getProviderRegistry()?.get(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
	if (!projectScope) return { queue: getApprovalQueue() };
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

function projectExecutionContext(
	runtime: DaemonProjectRuntimeScope,
): ToolRunnerContext {
	return {
		scopeId: runtime.project.projectId,
		projectId: runtime.project.projectId,
		cwd: runtime.project.projectDir,
	};
}

function listApprovalsLocal(
	queue: ApprovalQueue,
	status?: ApprovalStatus | "all",
): { approvals: ApprovalClientProjection[] } {
	if (status === undefined) return { approvals: queue.list("pending").map((item) => projectApprovalForClient(item)) };
	if (status === "all") return { approvals: queue.list().map((item) => projectApprovalForClient(item)) };
	return { approvals: queue.list(status).map((item) => projectApprovalForClient(item)) };
}

function approveApprovalLocal(
	queue: ApprovalQueue,
	id: string,
	note?: string,
): ApprovalExecutionApprovalResult {
	return queue.approveForExecution(id, note);
}

function rejectApprovalLocal(
	queue: ApprovalQueue,
	id: string,
	reason?: string,
): PendingApproval | null {
	return queue.reject(id, reason);
}

function approveAllApprovalsLocal(
	queue: ApprovalQueue,
	note?: string,
): ApprovalExecutionApproveAllResult {
	return queue.approveAllForExecution(note);
}

function rejectAllApprovalsLocal(
	queue: ApprovalQueue,
	reason?: string,
): { approvals: ApprovalClientProjection[]; count: number } {
	const items = queue.rejectAll(reason);
	return { approvals: items.map((item) => projectApprovalForClient(item)), count: items.length };
}

function rejectMalformedApprovalId(res: ServerResponse, id: string): boolean {
	if (isApprovalId(id)) return false;
	jsonResponse(res, 400, {
		error: "Invalid approval id",
		reason: "invalid_approval_id",
		id,
	});
	return true;
}

function writeApprovalInputUnavailable(
	res: ServerResponse,
	approvals: PendingApproval[],
): void {
	jsonResponse(res, 409, {
		error: "Approval input is unavailable after daemon restart",
		reason: "approval_input_unavailable",
		approvals: approvals.map((item) => projectApprovalForClient(item)),
	});
}

async function readOptionalStringField(
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

async function proxyApprovalMutation(
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

async function writeApproveApprovalMutation(
	res: ServerResponse,
	queue: ApprovalQueue,
	id: string,
	note: string | undefined,
	executionContext: ToolRunnerContext | undefined,
): Promise<void> {
	const pending = queue.get(id);
	let leases: Map<string, ApprovalExecutionLease> | undefined;
	if (pending?.status === "pending") {
		const preflight = await prepareApprovalExecutionBatch([pending], executionContext);
		if (!preflight.ok) {
			jsonResponse(res, preflight.status, preflight.body);
			return;
		}
		leases = preflight.leases;
	}
	const result = approveApprovalLocal(queue, id, note);
	if (!result.ok && result.reason === "not_found") {
		if (leases) await closeApprovalExecutionLeases(leases.values());
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
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

async function writeApproveAllApprovalsMutation(
	res: ServerResponse,
	queue: ApprovalQueue,
	note: string | undefined,
	executionContext: ToolRunnerContext | undefined,
): Promise<void> {
	const preflight = await prepareApprovalExecutionBatch(
		queue.list("pending"),
		executionContext,
	);
	if (!preflight.ok) {
		jsonResponse(res, preflight.status, preflight.body);
		return;
	}
	const result = approveAllApprovalsLocal(queue, note);
	if (!result.ok) {
		await closeApprovalExecutionLeases(preflight.leases.values());
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

export async function handleListApprovals(
	res: ServerResponse,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	status?: ApprovalStatus | "all",
	projectId?: string,
): Promise<void> {
	if (link) {
		const result = await link.request<{ approvals: ApprovalClientProjection[] }>(
			"GET",
			`/approvals${approvalQuery(status, projectId)}`,
		);
		if (result) {
			jsonResponse(res, 200, result);
			return;
		}
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	jsonResponse(res, 200, listApprovalsLocal(resolvedQueue.queue, status));
}

export async function handleApproveApproval(
	req: IncomingMessage,
	res: ServerResponse,
	id: string,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	if (rejectMalformedApprovalId(res, id)) return;
	const note = await readOptionalStringField(req, res, "note");
	if (!note.ok) return;

	if (link) {
		await proxyApprovalMutation(
			res,
			link,
			`/approvals/${encodeURIComponent(id)}/approve${projectQuery(projectId)}`,
			note.value === undefined ? {} : { note: note.value },
		);
		return;
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	await writeApproveApprovalMutation(
		res,
		resolvedQueue.queue,
		id,
		note.value,
		resolvedQueue.executionContext,
	);
}

export async function handleRejectApproval(
	req: IncomingMessage,
	res: ServerResponse,
	id: string,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	if (rejectMalformedApprovalId(res, id)) return;
	const reason = await readOptionalStringField(req, res, "reason");
	if (!reason.ok) return;

	if (link) {
		await proxyApprovalMutation(
			res,
			link,
			`/approvals/${encodeURIComponent(id)}/reject${projectQuery(projectId)}`,
			reason.value === undefined ? {} : { reason: reason.value },
		);
		return;
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	const item = rejectApprovalLocal(resolvedQueue.queue, id, reason.value);
	if (!item) {
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
		return;
	}
	jsonResponse(res, 200, { approval: projectApprovalForClient(item) });
}

export async function handleApproveAllApprovals(
	req: IncomingMessage,
	res: ServerResponse,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	const note = await readOptionalStringField(req, res, "note");
	if (!note.ok) return;

	if (link) {
		await proxyApprovalMutation(
			res,
			link,
			`/approvals/approve-all${projectQuery(projectId)}`,
			note.value === undefined ? {} : { note: note.value },
		);
		return;
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	await writeApproveAllApprovalsMutation(
		res,
		resolvedQueue.queue,
		note.value,
		resolvedQueue.executionContext,
	);
}

export async function handleRejectAllApprovals(
	req: IncomingMessage,
	res: ServerResponse,
	link: DaemonTransport | null = null,
	queue?: ApprovalQueue,
	projectId?: string,
): Promise<void> {
	const reason = await readOptionalStringField(req, res, "reason");
	if (!reason.ok) return;

	if (link) {
		await proxyApprovalMutation(
			res,
			link,
			`/approvals/reject-all${projectQuery(projectId)}`,
			reason.value === undefined ? {} : { reason: reason.value },
		);
		return;
	}
	const resolvedQueue = resolveApprovalQueue(res, queue, projectId);
	if (!resolvedQueue) return;
	jsonResponse(res, 200, rejectAllApprovalsLocal(resolvedQueue.queue, reason.value));
}


export function approvalRoutes(): RouteRegistration[] {
	return [
		{
			method: "GET",
			path: "/api/approvals",
			handler: (req, res) => {
				const projectId = readProjectId(req, res);
				if (projectId === null) return;
				return handleListApprovals(
					res,
					getDaemonTransport(),
					undefined,
					readStatusFilter(req),
					projectId,
				);
			},
		},
		{
			method: "POST",
			path: "/api/approvals/approve-all",
			handler: (req, res) => {
				const projectId = readProjectId(req, res);
				if (projectId === null) return;
				return handleApproveAllApprovals(
					req,
					res,
					getDaemonTransport(),
					undefined,
					projectId,
				);
			},
		},
		{
			method: "POST",
			path: "/api/approvals/reject-all",
			handler: (req, res) => {
				const projectId = readProjectId(req, res);
				if (projectId === null) return;
				return handleRejectAllApprovals(
					req,
					res,
					getDaemonTransport(),
					undefined,
					projectId,
				);
			},
		},
		{
			method: "POST",
			path: "/api/approvals/:id/approve",
			handler: (req, res, params) => {
				const projectId = readProjectId(req, res);
				if (projectId === null) return;
				return handleApproveApproval(
					req,
					res,
					params.id,
					getDaemonTransport(),
					undefined,
					projectId,
				);
			},
		},
		{
			method: "POST",
			path: "/api/approvals/:id/reject",
			handler: (req, res, params) => {
				const projectId = readProjectId(req, res);
				if (projectId === null) return;
				return handleRejectApproval(
					req,
					res,
					params.id,
					getDaemonTransport(),
					undefined,
					projectId,
				);
			},
		},
	];
}

async function handleListApprovalsControl(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const projectId = readProjectId(req, res);
	if (projectId === null) return;
	const queue = resolveApprovalQueue(res, undefined, projectId);
	if (!queue) return;
	jsonResponse(res, 200, listApprovalsLocal(queue.queue, readStatusFilter(req)));
}

async function handleApproveApprovalControl(
	req: IncomingMessage,
	res: ServerResponse,
	params: Record<string, string>,
): Promise<void> {
	if (rejectMalformedApprovalId(res, params.id)) return;
	const note = await readOptionalStringField(req, res, "note");
	if (!note.ok) return;
	const projectId = readProjectId(req, res);
	if (projectId === null) return;
	const queue = resolveApprovalQueue(res, undefined, projectId);
	if (!queue) return;
	await writeApproveApprovalMutation(
		res,
		queue.queue,
		params.id,
		note.value,
		queue.executionContext,
	);
}

async function handleRejectApprovalControl(
	req: IncomingMessage,
	res: ServerResponse,
	params: Record<string, string>,
): Promise<void> {
	if (rejectMalformedApprovalId(res, params.id)) return;
	const reason = await readOptionalStringField(req, res, "reason");
	if (!reason.ok) return;
	const projectId = readProjectId(req, res);
	if (projectId === null) return;
	const queue = resolveApprovalQueue(res, undefined, projectId);
	if (!queue) return;
	const item = rejectApprovalLocal(queue.queue, params.id, reason.value);
	if (!item) {
		jsonResponse(res, 404, { error: "Approval not found or not pending" });
		return;
	}
	jsonResponse(res, 200, { approval: projectApprovalForClient(item) });
}

async function handleApproveAllApprovalsControl(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const note = await readOptionalStringField(req, res, "note");
	if (!note.ok) return;
	const projectId = readProjectId(req, res);
	if (projectId === null) return;
	const queue = resolveApprovalQueue(res, undefined, projectId);
	if (!queue) return;
	await writeApproveAllApprovalsMutation(
		res,
		queue.queue,
		note.value,
		queue.executionContext,
	);
}

async function handleRejectAllApprovalsControl(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const reason = await readOptionalStringField(req, res, "reason");
	if (!reason.ok) return;
	const projectId = readProjectId(req, res);
	if (projectId === null) return;
	const queue = resolveApprovalQueue(res, undefined, projectId);
	if (!queue) return;
	jsonResponse(res, 200, rejectAllApprovalsLocal(queue.queue, reason.value));
}

export function approvalControlRoutes(): ControlRouteRegistration[] {
	return [
		{
			method: "GET",
			path: "/approvals",
			capabilityScope: "read",
			handler: handleListApprovalsControl,
		},
		{
			method: "POST",
			path: "/approvals/approve-all",
			capabilityScope: "control",
			handler: handleApproveAllApprovalsControl,
		},
		{
			method: "POST",
			path: "/approvals/reject-all",
			capabilityScope: "control",
			handler: handleRejectAllApprovalsControl,
		},
		{
			method: "POST",
			path: "/approvals/:id/approve",
			capabilityScope: "control",
			handler: handleApproveApprovalControl,
		},
		{
			method: "POST",
			path: "/approvals/:id/reject",
			capabilityScope: "control",
			handler: handleRejectApprovalControl,
		},
	];
}
