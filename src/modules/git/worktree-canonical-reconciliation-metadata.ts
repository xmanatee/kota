import { isAutomationWorktreeCanonicalReconciliation } from "./worktree-canonical-reconciliation-record.js";
import { inspectAutomationWorktree } from "./worktree-lifecycle.js";
import {
	readMetadata,
	writeMetadata,
} from "./worktree-lifecycle-support.js";
import type {
	AutomationWorktreeCanonicalReconciliation,
	AutomationWorktreeInspection,
	AutomationWorktreeSelector,
} from "./worktree-lifecycle-types.js";

export function updateAutomationWorktreeCanonicalReconciliation(
	selector: AutomationWorktreeSelector,
	canonicalReconciliation: AutomationWorktreeCanonicalReconciliation,
): AutomationWorktreeInspection {
	if (!isAutomationWorktreeCanonicalReconciliation(canonicalReconciliation)) {
		throw new Error("Cannot persist malformed canonical reconciliation metadata");
	}
	const current = readMetadata(selector);
	if (canonicalReconciliation.originalBaseCommit !== current.baseCommit) {
		throw new Error("Canonical reconciliation cannot rewrite the original worktree base");
	}
	const needsReview = canonicalReconciliation.disposition === "needs-review";
	writeMetadata(selector.projectDir, {
		...current,
		canonicalReconciliation,
		state: needsReview ? "pending-merge" : "active",
		stateReason: needsReview
			? canonicalReconciliation.reason ?? "canonical reconciliation needs review"
			: `canonical reconciliation ${canonicalReconciliation.phase}`,
		updatedAt: canonicalReconciliation.updatedAt,
		...(needsReview ? {} : { lastCleanupBlockers: [] }),
	});
	return inspectAutomationWorktree(selector);
}
