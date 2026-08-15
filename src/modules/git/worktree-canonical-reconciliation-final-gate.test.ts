import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { checkpointAndReconcileAutomationWorktree } from "./worktree-canonical-reconciliation.js";
import {
	commit,
	git,
	reconciliationFixture,
	reconciliationInput,
	write,
} from "./worktree-canonical-reconciliation-test-support.js";
import {
	inspectAutomationWorktree,
	lockAutomationWorktree,
} from "./worktree-lifecycle.js";
import { mergeAutomationWorktree } from "./worktree-merge-gate.js";

describe("preserved worktree reconciliation handoff", () => {
	it("preserves checkpoint, conflict artifact, and lock when resolution fails", async () => {
		const created = reconciliationFixture("failed-resolution", {
			"src/shared.ts": "export const value = 'base';\n",
		});
		write(created.workspaceDir, "src/shared.ts", "export const value = 'builder';\n");
		write(created.projectDir, "src/shared.ts", "export const value = 'canonical';\n");
		commit(created.projectDir, "canonical conflict");
		lockAutomationWorktree(created, "preserve recovery fixture");
		const resolver = vi.fn(() => ({
			resolved: false,
			summary: "fixture resolver refused ambiguous intent",
		}));
		const { input } = reconciliationInput(created, { resolver });

		const result = await checkpointAndReconcileAutomationWorktree(input);

		expect(result).toMatchObject({
			disposition: "needs-review",
			reason: "fixture resolver refused ambiguous intent",
			overlappingPaths: ["src/shared.ts"],
			conflicts: [{ path: "src/shared.ts", kind: "text" }],
		});
		expect(resolver).toHaveBeenCalledWith(
			expect.objectContaining({
				conflicts: [expect.objectContaining({ path: "src/shared.ts" })],
			}),
		);
		expect(result.checkpointCommit).not.toBeNull();
		expect(readFileSync(result.artifactPath, "utf8")).toContain(
			"fixture resolver refused ambiguous intent",
		);
		const inspection = inspectAutomationWorktree(created);
		expect(inspection.lock).toMatchObject({ locked: true });
		expect(inspection.dirty.conflicted).toBe(true);
		expect(inspection.metadata.state).toBe("pending-merge");
	});

	it("leaves later canonical commits to one authoritative final merge gate", async () => {
		const created = reconciliationFixture("later-final", {
			"src/preserved.ts": "export const preserved = 1;\n",
		});
		write(created.workspaceDir, "src/preserved.ts", "export const preserved = 2;\n");
		write(created.projectDir, "src/canonical-before.ts", "export const before = true;\n");
		const preAgentCanonical = commit(created.projectDir, "canonical before recovery");
		const { input } = reconciliationInput(created);
		const reconciled = await checkpointAndReconcileAutomationWorktree(input);
		expect(reconciled.branchBehindAtResume).toBe(0);
		expect(reconciled.integratedCanonicalHeadCommit).toBe(preAgentCanonical);

		write(created.workspaceDir, "src/builder-finish.ts", "export const built = true;\n");
		commit(created.workspaceDir, "finish preserved task");
		write(created.projectDir, "src/canonical-after.ts", "export const after = true;\n");
		const laterCanonical = commit(created.projectDir, "canonical after continuation");

		const merged = await mergeAutomationWorktree({
			projectDir: created.projectDir,
			taskId: created.taskId,
			runId: created.runId,
			validationCommand: [process.execPath, "-e", "process.exit(0)"],
		});

		expect(merged).toMatchObject({
			status: "merged",
			canonicalHeadCommit: laterCanonical,
			resolutionAttempts: 0,
		});
		expect(git(created.projectDir, ["rev-parse", "HEAD"])).toBe(merged.mergeCommit);
		const finalMergeParents = git(created.projectDir, [
			"rev-list",
			"--parents",
			"-n",
			"1",
			merged.mergeCommit ?? "HEAD",
		]).split(/\s+/);
		expect(finalMergeParents).toHaveLength(3);
		expect(finalMergeParents.filter((commit) => commit === laterCanonical)).toHaveLength(1);
	});
});
