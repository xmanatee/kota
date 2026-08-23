import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, vi } from "vitest";
import type { CheckpointAndReconcileAutomationWorktreeInput } from "./worktree-canonical-reconciliation.js";
import { updateAutomationWorktreeCanonicalReconciliation } from "./worktree-canonical-reconciliation-metadata.js";
import {
	createAutomationWorktree,
} from "./worktree-lifecycle.js";
import type { AutomationWorktreeCanonicalReconciliation } from "./worktree-lifecycle-types.js";

const roots: string[] = [];

afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

export function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

export function write(root: string, path: string, content: string): void {
	const target = join(root, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content, "utf8");
}

export function commit(repo: string, message: string): string {
	git(repo, ["add", "-A"]);
	git(repo, ["commit", "-q", "-m", message]);
	return git(repo, ["rev-parse", "HEAD"]);
}

export function reconciliationFixture(label: string, files: Record<string, string>) {
	const projectDir = mkdtempSync(join(tmpdir(), `kota-canonical-reconcile-${label}-`));
	roots.push(projectDir);
	git(projectDir, ["init", "-q", "-b", "main"]);
	git(projectDir, ["config", "user.email", "test@example.com"]);
	git(projectDir, ["config", "user.name", "KOTA Test"]);
	write(projectDir, ".gitignore", ".kota/\n.worktrees/\n");
	for (const [path, content] of Object.entries(files)) write(projectDir, path, content);
	const baseCommit = commit(projectDir, "base");
	const taskId = `task-${label}`;
	const runId = `run-${label}`;
	const created = createAutomationWorktree({
		projectDir,
		taskId,
		runId,
		workflowId: "builder",
		owner: "workflow:builder",
	});
	return {
		projectDir,
		workspaceDir: created.metadata.workspaceDir,
		taskId,
		runId,
		baseCommit,
	};
}

export function reconciliationInput(
	created: ReturnType<typeof reconciliationFixture>,
	overrides: Partial<CheckpointAndReconcileAutomationWorktreeInput> = {},
) {
	const artifactPath = join(
		created.projectDir,
		".kota",
		"runs",
		`recovery-${created.runId}`,
		"preserved-canonical-reconciliation.json",
	);
	const phases: string[] = [];
	return {
		phases,
		input: {
			projectDir: created.projectDir,
			taskId: created.taskId,
			runId: created.runId,
			recoveryRunId: `recovery-${created.runId}`,
			artifactPath,
			validationCommands: [[process.execPath, "-e", "process.exit(0)"]],
			onProgress: (record: AutomationWorktreeCanonicalReconciliation) => {
				phases.push(record.phase);
				mkdirSync(dirname(artifactPath), { recursive: true });
				writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
				updateAutomationWorktreeCanonicalReconciliation(
					{
						projectDir: created.projectDir,
						taskId: created.taskId,
						runId: created.runId,
					},
					record,
				);
			},
			...overrides,
		} satisfies CheckpointAndReconcileAutomationWorktreeInput,
	};
}
