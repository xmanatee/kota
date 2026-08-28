import { evidenceRetentionDurationMsFor } from "#core/evidence/policy.js";
import type { PendingApproval } from "./approval-queue-types.js";

export const DEFAULT_APPROVAL_PENDING_TTL_MS = evidenceRetentionDurationMsFor({
	artifactType: "approval",
	state: "pending",
	scope: "directory",
});

export function defaultApprovalPendingTtlMs(): number {
	return DEFAULT_APPROVAL_PENDING_TTL_MS;
}

export function expireApproval(
	item: PendingApproval,
	resolvedAt?: string,
	resolutionSource = "timeout",
): "deny" | "approve" {
	const resolution = item.defaultResolution ?? "deny";
	item.resolvedAt = resolvedAt ?? new Date().toISOString();
	item.resolutionSource = resolutionSource;
	if (resolution === "approve") {
		item.status = "approved";
	} else {
		item.status = "expired";
		item.rejectionReason = "expired";
	}
	return resolution;
}
