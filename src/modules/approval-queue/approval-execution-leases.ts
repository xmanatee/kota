import type { ApprovalExecutionDescriptor } from "#core/daemon/approval-execution-descriptor.js";
import type { McpManager } from "#core/mcp/manager.js";
import type { LocalToolExecutionLease } from "#core/tools/local-tool-approval-binding.js";

export type ApprovalExecutionLease = ApprovalExecutionDescriptor & {
	mcpManager?: McpManager;
	localTool?: LocalToolExecutionLease;
};

export async function closeApprovalExecutionLeases(
	leases: Iterable<ApprovalExecutionLease>,
): Promise<void> {
	const managers = new Set<McpManager>();
	for (const lease of leases) {
		if (lease.mcpManager !== undefined) managers.add(lease.mcpManager);
	}
	await Promise.all([...managers].map((manager) => manager.close()));
}

export async function closeApprovalExecutionAfterFailure(
	close: () => Promise<void>,
	primaryError: Error,
	message: string,
): Promise<void> {
	try {
		await close();
	} catch (cleanupError) {
		throw new AggregateError([primaryError, cleanupError], message);
	}
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
		await closeApprovalExecutionAfterFailure(
			() => closeApprovalExecutionLeases(retainedLeases),
			primaryError,
			"Approval execution and lease cleanup both failed",
		);
		throw error;
	}
	await closeApprovalExecutionLeases(retainedLeases);
	return result;
}
