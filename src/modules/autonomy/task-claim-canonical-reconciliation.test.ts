import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AutomationWorktreeCanonicalReconciliation } from "#modules/git/worktree-lifecycle-types.js";
import {
	claimTask,
	markTaskClaimPendingMerge,
	readActiveTaskClaim,
	updateTaskClaimCanonicalReconciliation,
} from "./task-claims.js";
import {
	claimInput,
	makeProject,
	writeTask,
} from "./task-claims-test-support.js";

let projectDir: string;

beforeEach(() => {
	projectDir = makeProject();
	writeTask(projectDir, "ready", "task-alpha", "2026-08-15T00:00:00.000Z");
});

afterEach(() => {
	rmSync(projectDir, { recursive: true, force: true });
});

describe("task claim canonical reconciliation evidence", () => {
	it("persists reconciliation lineage and retains it when review becomes pending", () => {
		expect(
			claimTask(
				claimInput(
					projectDir,
					"task-alpha",
					"run-recovery",
					new Date("2026-08-15T00:00:00.000Z"),
				),
			),
		).toMatchObject({ claimed: true });
		const canonicalReconciliation: AutomationWorktreeCanonicalReconciliation = {
			phase: "conflict-blocked",
			disposition: "needs-review",
			originalBaseCommit: "base-commit",
			checkpointCommit: "checkpoint123",
			canonicalHeadCommit: "canonical123",
			integratedCanonicalHeadCommit: null,
			branchBehindAtStart: 3,
			branchBehindAtResume: null,
			overlappingPaths: ["src/shared.ts"],
			canonicalDestructivePaths: [],
			conflicts: [
				{
					path: "src/shared.ts",
					kind: "text",
					reason: "ambiguous source intent",
				},
			],
			validations: [],
			reason: "bounded resolver refused ambiguous source intent",
			artifactPath: ".kota/runs/run-recovery/preserved-canonical-reconciliation.json",
			updatedAt: "2026-08-15T00:01:00.000Z",
		};

		const updated = updateTaskClaimCanonicalReconciliation({
			projectDir,
			taskId: "task-alpha",
			runId: "run-recovery",
			workflowId: "builder",
			evidence: "canonical reconciliation needs review",
			canonicalReconciliation,
		});
		expect(updated).toMatchObject({
			changed: true,
			claim: { canonicalReconciliation },
		});

		markTaskClaimPendingMerge({
			projectDir,
			taskId: "task-alpha",
			runId: "run-recovery",
			workflowId: "builder",
			evidence: "canonical reconciliation conflict is preserved",
		});
		expect(readActiveTaskClaim(projectDir, "task-alpha")).toMatchObject({
			status: "pending-merge",
			baseCommit: expect.any(String),
			canonicalReconciliation,
		});
	});
});
