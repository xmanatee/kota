import type { ScopedEventBus } from "#core/events/scope.js";
import type { PendingApproval } from "./approval-queue.js";

export function emitApprovalRequested(
	pbus: ScopedEventBus | null,
	item: PendingApproval,
	sessionId: string | undefined,
	pendingCount: number,
): void {
	if (!pbus) return;
	pbus.emit("approval.requested", {
		id: item.id,
		tool: item.tool,
		risk: item.risk,
		reason: item.reason,
		source: item.source ?? "",
		sessionId: sessionId ?? "",
	});
	pbus.emit("approval.changed", { id: item.id, pendingCount });
}

export function emitApprovalResolved(
	pbus: ScopedEventBus | null,
	item: PendingApproval,
	approved: boolean,
	reason: string,
	pendingCount: number,
): void {
	if (!pbus) return;
	pbus.emit("approval.resolved", {
		id: item.id,
		tool: item.tool,
		approved,
		reason,
		source: item.source ?? "",
		sessionId: item.sessionId ?? "",
	});
	pbus.emit("approval.changed", { id: item.id, pendingCount });
}

export function emitApprovalExpired(
	pbus: ScopedEventBus | null,
	item: PendingApproval,
	defaultResolution: "deny" | "approve",
	pendingCount: number,
): void {
	if (!pbus) return;
	pbus.emit("workflow.approval.timeout", {
		id: item.id,
		tool: item.tool,
		defaultResolution,
	});
	pbus.emit("approval.expired", { id: item.id, tool: item.tool });
	emitApprovalResolved(
		pbus,
		item,
		defaultResolution === "approve",
		item.rejectionReason ?? "",
		pendingCount,
	);
}
