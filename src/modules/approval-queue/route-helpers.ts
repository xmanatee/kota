import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type ApprovalClientProjection,
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
import type { ApprovalReviewReceipt } from "./client.js";

type OptionalStringFieldRead =
	| { ok: true; value?: string }
	| { ok: false };

type ApprovalDecisionBodyRead =
	| { ok: true; note?: string; reviewDigest: string }
	| { ok: false };

type ApprovalBatchDecisionBodyRead =
	| { ok: true; note?: string; reviews: ApprovalReviewReceipt[] }
	| { ok: false };

const REVIEW_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

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
		return { approvals: queue.list("pending").map((item) => queue.projectForClient(item)) };
	}
	if (status === "all") {
		return { approvals: queue.list().map((item) => queue.projectForClient(item)) };
	}
	return { approvals: queue.list(status).map((item) => queue.projectForClient(item)) };
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

export async function readApprovalDecisionBody(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<ApprovalDecisionBodyRead> {
	try {
		const body = await readBody(req);
		if (
			typeof body.reviewDigest !== "string"
			|| !REVIEW_DIGEST_PATTERN.test(body.reviewDigest)
			|| (body.note !== undefined && typeof body.note !== "string")
		) {
			jsonResponse(res, 400, {
				error: "A valid reviewed operation digest is required",
				reason: "invalid_approval_review_receipt",
			});
			return { ok: false };
		}
		return {
			ok: true,
			reviewDigest: body.reviewDigest,
			...(typeof body.note === "string" ? { note: body.note } : {}),
		};
	} catch {
		jsonResponse(res, 400, { error: "Invalid request body" });
		return { ok: false };
	}
}

export async function readApprovalBatchDecisionBody(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<ApprovalBatchDecisionBodyRead> {
	try {
		const body = await readBody(req);
		if (!Array.isArray(body.reviews) || (body.note !== undefined && typeof body.note !== "string")) {
			jsonResponse(res, 400, {
				error: "Reviewed operation digests are required",
				reason: "invalid_approval_review_receipt",
			});
			return { ok: false };
		}
		const reviews: ApprovalReviewReceipt[] = [];
		for (const entry of body.reviews) {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
				jsonResponse(res, 400, {
					error: "Reviewed operation digests are required",
					reason: "invalid_approval_review_receipt",
				});
				return { ok: false };
			}
			const record = entry as Record<string, string>;
			if (!isApprovalId(record.id) || !REVIEW_DIGEST_PATTERN.test(record.digest)) {
				jsonResponse(res, 400, {
					error: "Reviewed operation digests are required",
					reason: "invalid_approval_review_receipt",
				});
				return { ok: false };
			}
			reviews.push({ id: record.id, digest: record.digest });
		}
		return {
			ok: true,
			reviews,
			...(typeof body.note === "string" ? { note: body.note } : {}),
		};
	} catch {
		jsonResponse(res, 400, { error: "Invalid request body" });
		return { ok: false };
	}
}

export async function proxyApprovalMutation(
	res: ServerResponse,
	link: DaemonTransport,
	path: string,
	body:
		| { note?: string; reviewDigest: string }
		| { note?: string; reviews: ApprovalReviewReceipt[] }
		| { reason?: string },
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

function projectExecutionContext(
	runtime: DaemonProjectRuntimeScope,
): ToolRunnerContext {
	return {
		scopeId: runtime.project.projectId,
		projectId: runtime.project.projectId,
		projectDir: runtime.project.projectDir,
		cwd: runtime.project.projectDir,
	};
}
