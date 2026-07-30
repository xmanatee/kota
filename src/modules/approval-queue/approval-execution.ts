import {
	type ApprovalExecutionDescriptor,
	approvedApprovalMatchesExecutionDescriptor,
} from "#core/daemon/approval-execution-descriptor.js";
import {
	type ApprovalClientProjection,
	type PendingApproval,
	projectApprovalForClient,
} from "#core/daemon/approval-queue.js";
import { projectEvidenceText } from "#core/evidence/policy.js";
import type { McpManager } from "#core/mcp/manager.js";
import { executeTool, type ToolRunnerContext } from "#core/tools/index.js";
import { isMcpManagedToolName } from "#core/tools/tool-name-policy.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type { ApprovalExecutionProjection } from "./client.js";

export {
	closeApprovalExecutionLeases,
	withApprovalExecutionLeases,
} from "./approval-execution-leases.js";
export {
	type ApprovalExecutionPreflightBatch,
	prepareApprovalExecutionBatch,
} from "./approval-execution-preflight.js";

export type ApprovalExecutionLease = ApprovalExecutionDescriptor & {
	mcpManager?: McpManager;
};

export class ApprovalExecutionDescriptorMismatchError extends Error {
	constructor(readonly approval: PendingApproval) {
		super(`Approval ${approval.id} no longer matches its execution lease`);
		this.name = "ApprovalExecutionDescriptorMismatchError";
	}
}

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
	execution: ApprovalExecutionProjection;
}> {
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
		requireApprovedToolExecutionLease(item, leases.get(item.id));
	}
	const executions: Array<{ approvalId: string; execution: ApprovalExecutionProjection }> = [];
	for (const item of items) {
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
