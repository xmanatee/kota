import type { McpManager } from "#core/mcp/manager.js";
import type { ApprovalExecutionLease } from "./approval-execution.js";

export async function closeApprovalExecutionLeases(
	leases: Iterable<ApprovalExecutionLease>,
): Promise<void> {
	const managers = new Set<McpManager>();
	for (const lease of leases) {
		if (lease.mcpManager !== undefined) managers.add(lease.mcpManager);
	}
	await Promise.all([...managers].map((manager) => manager.close()));
}

async function closeAfterFailure(
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
		await closeAfterFailure(
			() => closeApprovalExecutionLeases(retainedLeases),
			primaryError,
			"Approval execution and lease cleanup both failed",
		);
		throw error;
	}
	await closeApprovalExecutionLeases(retainedLeases);
	return result;
}
