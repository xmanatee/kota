import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { cleanupAutomationWorktree } from "#modules/git/worktree-lifecycle.js";

export type AutomationWorktreeCleanupResult = {
	removed: boolean;
	workspaceDir: string | null;
	metadataPath: string | null;
	artifactPath: string;
	state: string | null;
	cleanupEligible: boolean;
	blockers: string[];
};

type CleanupAutomationWorktreeInput = {
	projectDir: string;
	taskId: string;
	runId: string;
	runDirPath: string;
};

export function cleanupAutomationWorktreeInWorker(
	input: CleanupAutomationWorktreeInput,
): AutomationWorktreeCleanupResult {
	const result = cleanupAutomationWorktree({
		projectDir: input.projectDir,
		taskId: input.taskId,
		runId: input.runId,
	});
	const artifact = {
		removed: result.removed,
		workspaceDir: result.inspection.metadata.workspaceDir,
		metadataPath: result.inspection.metadataPath,
		artifactPath: join(input.runDirPath, "automation-worktree-cleanup.json"),
		state: result.inspection.metadata.state,
		cleanupEligible: result.inspection.cleanup.eligible,
		blockers: result.inspection.cleanup.blockers,
	};
	mkdirSync(dirname(artifact.artifactPath), { recursive: true });
	writeFileSync(artifact.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
	return artifact;
}

export const cleanupAutomationWorktreeOperation = defineWorkflowBlockingOperation<
	CleanupAutomationWorktreeInput,
	AutomationWorktreeCleanupResult
>(import.meta.url, "cleanupAutomationWorktreeInWorker");
