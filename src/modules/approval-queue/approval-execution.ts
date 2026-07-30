import {
	type ApprovalExecutionDescriptor,
	approvedApprovalMatchesExecutionDescriptor,
} from "#core/daemon/approval-execution-descriptor.js";
import {
	type ApprovalClientProjection,
	type ApprovalExecutionSnapshot,
	isWorkflowStepApproval,
	type PendingApproval,
	projectApprovalForClient,
} from "#core/daemon/approval-queue.js";
import { projectEvidenceText } from "#core/evidence/policy.js";
import type { McpManager } from "#core/mcp/manager.js";
import { executeTool, type ToolRunnerContext } from "#core/tools/index.js";
import { isMcpManagedToolName } from "#core/tools/tool-name-policy.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { closeAfterApprovalExecutionFailure } from "./approval-execution-cleanup.js";
import { prepareMcpApprovalExecution } from "./approval-mcp-preflight.js";
import type { ApprovalExecutionProjection } from "./client.js";

export type ApprovalExecutionLease = ApprovalExecutionDescriptor & {
	mcpManager?: McpManager;
};

export class ApprovalExecutionDescriptorMismatchError extends Error {
	constructor(readonly approval: PendingApproval) {
		super(`Approval ${approval.id} no longer matches its execution lease`);
		this.name = "ApprovalExecutionDescriptorMismatchError";
	}
}

export type ApprovalExecutionPreflightBatch =
	| { ok: true; leases: Map<string, ApprovalExecutionLease> }
	| { ok: false; status: 409; body: import("./approval-mcp-preflight.js").McpApprovalFailureBody };

function approvalExecutionContext(
	base: ToolRunnerContext | undefined,
	item: PendingApproval,
): ToolRunnerContext | undefined {
	if (!base && !item.sessionId) return undefined;
	return {
		...base,
		...(item.sessionId ? { sessionId: item.sessionId } : {}),
	};
}

export async function closeApprovalExecutionLeases(
	leases: Iterable<ApprovalExecutionLease>,
): Promise<void> {
	const managers = new Set<McpManager>();
	for (const lease of leases) {
		if (lease.mcpManager !== undefined) managers.add(lease.mcpManager);
	}
	await Promise.all([...managers].map((manager) => manager.close()));
}

export async function withApprovalExecutionLeases<T>(
	leases: Iterable<ApprovalExecutionLease>,
	execute: () => Promise<T>,
): Promise<T> {
	const retainedLeases = [...leases];
	let result: T;
	try {
		result = await execute();
	} catch (error) {
		const primaryError = error instanceof Error ? error : new Error(String(error));
		await closeAfterApprovalExecutionFailure(
			() => closeApprovalExecutionLeases(retainedLeases),
			primaryError,
			"Approval execution and lease cleanup both failed",
		);
		throw error;
	}
	await closeApprovalExecutionLeases(retainedLeases);
	return result;
}

export async function prepareApprovalExecutionBatch(
	snapshots: ApprovalExecutionSnapshot[],
	context?: ToolRunnerContext,
): Promise<ApprovalExecutionPreflightBatch> {
	const leases = new Map<string, ApprovalExecutionLease>();
	for (const snapshot of snapshots) {
		const preflight = await prepareMcpApprovalExecution(snapshot, context);
		if (!preflight.ok) {
			await closeApprovalExecutionLeases(leases.values());
			return preflight;
		}
		leases.set(snapshot.approval.id, preflight.lease);
	}
	return { ok: true, leases };
}

function projectToolExecution(result: ToolResult): ApprovalExecutionProjection {
	const projected = projectEvidenceText(result.content, "daemon-api", "tool-io");
	const output = typeof projected === "string"
		? {
			redacted: true as const,
			reason: "tool-io" as const,
			bytes: Buffer.byteLength(projected, "utf8"),
		}
		: {
			redacted: true as const,
			reason: "tool-io" as const,
			...(projected.bytes !== undefined ? { bytes: projected.bytes } : {}),
		};
	return {
		status: result.is_error ? "failed" : "succeeded",
		output,
	};
}

function requireApprovedToolExecutionLease(
	item: PendingApproval,
	lease: ApprovalExecutionLease | undefined,
): ApprovalExecutionLease {
	if (
		lease === undefined
		|| !approvedApprovalMatchesExecutionDescriptor(item, lease)
		|| (isMcpManagedToolName(item.tool) && lease.mcpManager === undefined)
	) {
		throw new ApprovalExecutionDescriptorMismatchError(item);
	}
	return lease;
}

function requireApprovedApprovalLease(
	item: PendingApproval,
	lease: ApprovalExecutionLease | undefined,
): ApprovalExecutionLease {
	if (lease === undefined || !approvedApprovalMatchesExecutionDescriptor(item, lease)) {
		throw new ApprovalExecutionDescriptorMismatchError(item);
	}
	return lease;
}

async function executeApprovedTool(
	item: PendingApproval,
	context?: ToolRunnerContext,
	lease?: ApprovalExecutionLease,
): Promise<ApprovalExecutionProjection> {
	const boundLease = requireApprovedToolExecutionLease(item, lease);
	const executionContext = approvalExecutionContext(context, item);
	if (isMcpManagedToolName(item.tool)) {
		const mcpManager = boundLease.mcpManager;
		if (mcpManager === undefined) {
			throw new ApprovalExecutionDescriptorMismatchError(item);
		}
		const result = await mcpManager.executeTool(item.tool, item.input);
		return projectToolExecution(result);
	}
	const result = executionContext
		? await executeTool(item.tool, item.input, executionContext)
		: await executeTool(item.tool, item.input);
	return projectToolExecution(result);
}

export async function approvedApprovalResponse(
	item: PendingApproval,
	context: ToolRunnerContext | undefined,
	lease: ApprovalExecutionLease,
): Promise<{
	approval: ApprovalClientProjection;
	execution?: ApprovalExecutionProjection;
}> {
	if (isWorkflowStepApproval(item)) {
		requireApprovedApprovalLease(item, lease);
		return { approval: projectApprovalForClient(item) };
	}
	const execution = await executeApprovedTool(item, context, lease);
	return {
		approval: projectApprovalForClient(item),
		execution,
	};
}

export async function approveAllResponse(
	items: PendingApproval[],
	context: ToolRunnerContext | undefined,
	leases: Map<string, ApprovalExecutionLease>,
): Promise<{
	approvals: ApprovalClientProjection[];
	count: number;
	executions: Array<{ approvalId: string; execution: ApprovalExecutionProjection }>;
}> {
	for (const item of items) {
		if (isWorkflowStepApproval(item)) {
			requireApprovedApprovalLease(item, leases.get(item.id));
		} else {
			requireApprovedToolExecutionLease(item, leases.get(item.id));
		}
	}
	const executions: Array<{ approvalId: string; execution: ApprovalExecutionProjection }> = [];
	for (const item of items) {
		if (isWorkflowStepApproval(item)) continue;
		executions.push({
			approvalId: item.id,
			execution: await executeApprovedTool(item, context, leases.get(item.id)),
		});
	}
	return {
		approvals: items.map((item) => projectApprovalForClient(item)),
		count: items.length,
		executions,
	};
}
