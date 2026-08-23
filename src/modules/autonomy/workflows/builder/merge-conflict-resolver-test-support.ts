import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import {
	type AgentHarness,
	type AgentHarnessRunOptions,
	clearAgentHarnessRegistryForTest,
	registerAgentHarness,
} from "#core/agent-harness/index.js";
import {
	type AgentRuntimeSelection,
	getPreset,
	SHIPPED_DEFAULT_PRESET_ID,
} from "#core/model/preset.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { createWorkflowAgentHarnessRunner } from "#core/workflow/steps/workflow-agent-harness-runner.js";
import { updateTaskClaimCanonicalReconciliation } from "#modules/autonomy/task-claims.js";
import { updateAutomationWorktreeCanonicalReconciliation } from "#modules/git/worktree-canonical-reconciliation-metadata.js";
import { createAutomationWorktree } from "#modules/git/worktree-lifecycle.js";
import type { AutomationWorktreeCanonicalReconciliation } from "#modules/git/worktree-lifecycle-types.js";
import type { MergeGateResolverRequest } from "#modules/git/worktree-merge-gate.js";
import {
	createMergeConflictResolver,
	resolveMergeConflictResolverRunContract,
} from "./merge-conflict-resolver.js";
import { cleanupCodexAdapterFixtures } from "./merge-conflict-resolver-codex-adapter-test-support.js";

const tempDirs: string[] = [];

export const TEST_PRESET = getPreset(SHIPPED_DEFAULT_PRESET_ID);
export const TASK_ID = "task-native-merge-conflict";
export const runAgentHarness = createWorkflowAgentHarnessRunner(undefined);

function testAgentRuntime(harness: string): AgentRuntimeSelection {
	return {
		preset: TEST_PRESET,
		harness,
		tiers: { ...TEST_PRESET.tiers },
		effort: "xhigh",
	};
}

export function mergeResolverContract(harness: string) {
	return resolveMergeConflictResolverRunContract(testAgentRuntime(harness));
}

export function nativeMergeResolver(projectDir: string, runId: string) {
	return createMergeConflictResolver({
		runDirPath: join(projectDir, `.kota/runs/${runId}`),
		workflowName: "builder",
		runId,
		agentContract: mergeResolverContract("codex"),
		runAgentHarness,
	});
}

export function persistNativeRecoveryProgress(input: {
	projectDir: string;
	taskId: string;
	worktreeRunId: string;
	recoveryRunId: string;
}) {
	return (record: AutomationWorktreeCanonicalReconciliation): void => {
		updateAutomationWorktreeCanonicalReconciliation(
			{
				projectDir: input.projectDir,
				taskId: input.taskId,
				runId: input.worktreeRunId,
			},
			record,
		);
		const claim = updateTaskClaimCanonicalReconciliation({
			projectDir: input.projectDir,
			taskId: input.taskId,
			runId: input.recoveryRunId,
			workflowId: "builder",
			evidence: `native preserved recovery ${record.phase}`,
			canonicalReconciliation: record,
		});
		if (!claim.changed) {
			throw new Error(claim.reason ?? "native fixture could not persist claim reconciliation");
		}
	};
}

function taskContract(acceptanceEvidence = "- Focused fixture proves the merge result."): string {
	return `---
id: ${TASK_ID}
title: Resolve a native merge conflict
status: ready
priority: p1
area: autonomy
summary: Resolve a bounded textual merge conflict.
created_at: 2026-08-16T00:00:00.000Z
updated_at: 2026-08-16T00:00:00.000Z
---

## Done When

- The textual conflict is resolved.

## Acceptance Evidence

${acceptanceEvidence}
`;
}

export function writeTaskContract(workspaceDir: string, acceptanceEvidence?: string): void {
	const taskDir = join(workspaceDir, "data/tasks/ready");
	mkdirSync(taskDir, { recursive: true });
	writeFileSync(join(taskDir, `${TASK_ID}.md`), taskContract(acceptanceEvidence), "utf8");
}

export function makeWorkspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "kota-merge-resolver-"));
	tempDirs.push(dir);
	writeTaskContract(dir);
	mkdirSync(join(dir, "src"), { recursive: true });
	writeFileSync(join(dir, "src/conflict.ts"), "export const value = 'branch';\n", "utf8");
	git(dir, ["init", "--quiet", "--initial-branch=main"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "Test"]);
	git(dir, ["add", "."]);
	git(dir, ["commit", "--quiet", "-m", "initial"]);
	return dir;
}

export function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		env: {
			...withProtectedGitBareRepositoryEnv(),
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function commitFile(repo: string, path: string, content: string, message: string): void {
	writeFileSync(join(repo, path), content, "utf8");
	git(repo, ["add", path]);
	git(repo, ["commit", "--quiet", "-m", message]);
}

export function makeMergeConflictFixture() {
	const projectDir = makeWorkspace();
	writeFileSync(join(projectDir, ".gitignore"), ".kota/\n.worktrees/\n", "utf8");
	writeFileSync(join(projectDir, "settings.txt"), "value=base\n", "utf8");
	writeTaskContract(projectDir);
	git(projectDir, ["add", ".gitignore", "settings.txt", "data/tasks/ready"]);
	git(projectDir, ["commit", "--quiet", "-m", "initial"]);
	const worktree = createAutomationWorktree({
		projectDir,
		taskId: TASK_ID,
		runId: "run-native-merge-conflict",
		workflowId: "builder",
		owner: "test-owner",
	});
	commitFile(worktree.metadata.workspaceDir, "settings.txt", "value=branch\n", "branch setting");
	commitFile(projectDir, "settings.txt", "value=canonical\n", "canonical setting");
	return { projectDir, worktree };
}

export function makeRequest(workspaceDir: string): MergeGateResolverRequest {
	const headCommit = git(workspaceDir, ["rev-parse", "HEAD"]);
	return {
		taskId: TASK_ID,
		workspaceDir,
		branch: "kota/task/task-native-merge-conflict/test-run",
		baseCommit: headCommit,
		canonicalHeadCommit: headCommit,
		headCommit,
		canonicalDiff: "diff --git a/src/conflict.ts b/src/conflict.ts\n+canonical change",
		attempt: 1,
		conflicts: [{ path: "src/conflict.ts", kind: "text", reason: "both modified" }],
		previousValidation: null,
	};
}

export function registerHarness(
	toolControl: AgentHarness["toolControl"] = "kota",
	name = "test-harness",
): ReturnType<typeof vi.fn> {
	const run = vi.fn(async (options: AgentHarnessRunOptions) => {
		options.abortQuarantine?.register(() => undefined);
		if (options.agentWriteScope === "deny-all") {
			return {
				text: JSON.stringify({
					verdict: "resolved",
					summary: "resolved conflict within the claimed task scope",
					taskScopeJustification: "The resolution preserves the task behavior while accepting the canonical change.",
					pathJudgments: [
						{
							path: options.prompt.includes("settings.txt") ? "settings.txt" : "src/conflict.ts",
							decision: "combine",
							rationale: "The resolved text incorporates the relevant branch and canonical intent.",
						},
					],
				}),
				streamedText: "",
				turns: 1,
				isError: false,
			};
		}
		if (options.cwd && existsSync(join(options.cwd, "src/conflict.ts"))) {
			writeFileSync(
				join(options.cwd, "src/conflict.ts"),
				"export const value = 'reconciled';\n",
				"utf8",
			);
		}
		return {
			text: "resolved conflict",
			streamedText: "resolved conflict",
			turns: 1,
			isError: false,
		};
	});
	registerAgentHarness({
		name,
		description: "test harness",
		supportsMultiTurn: true,
		supportedHookKinds: ["preRun", "postRun"],
		askOwnerToolName: null,
		emitsAgentMessageStream: false,
		toolControl,
		...(toolControl === "native" ? { nativeAbortQuarantine: "confirmed-stop" as const } : {}),
		run,
	});
	return run;
}

export function cleanupMergeResolverFixtures(): void {
	cleanupCodexAdapterFixtures();
	clearAgentHarnessRegistryForTest();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
