import { evidenceRetentionDurationMsFor } from "#core/evidence/policy.js";

const PENDING_APPROVAL_TTL_MS = evidenceRetentionDurationMsFor({
	artifactType: "approval",
	state: "pending",
	scope: "directory",
});

export function defaultApprovalPendingTtlMs(): number {
	return PENDING_APPROVAL_TTL_MS;
}
