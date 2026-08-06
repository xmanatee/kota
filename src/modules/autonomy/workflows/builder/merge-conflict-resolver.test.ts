import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import {
	createAutomationWorktree,
	inspectAutomationWorktree,
} from "#modules/git/worktree-lifecycle.js";
import {
	type MergeGateResolverRequest,
	mergeAutomationWorktree,
} from "#modules/git/worktree-merge-gate.js";
import {
	createMergeConflictResolver,
	MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS,
	resolveMergeConflictResolverRunContract,
} from "./merge-conflict-resolver.js";

const tempDirs: string[] = [];
const runAgentHarness = createWorkflowAgentHarnessRunner(undefined);
const TEST_PRESET = getPreset(SHIPPED_DEFAULT_PRESET_ID);

function testAgentRuntime(harness: string): AgentRuntimeSelection {
	return {
		preset: TEST_PRESET,
		harness,
		tiers: { ...TEST_PRESET.tiers },
		effort: "xhigh",
	};
}

function mergeResolverContract(harness: string) {
	return resolveMergeConflictResolverRunContract(testAgentRuntime(harness));
}

function makeWorkspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "kota-merge-resolver-"));
	tempDirs.push(dir);
	return dir;
}

function git(cwd: string, args: string[]): string {
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

function makeMergeConflictFixture() {
	const projectDir = makeWorkspace();
	git(projectDir, ["init", "--quiet", "--initial-branch=main"]);
	git(projectDir, ["config", "user.email", "test@example.com"]);
	git(projectDir, ["config", "user.name", "Test"]);
	writeFileSync(join(projectDir, ".gitignore"), ".kota/\n.worktrees/\n", "utf8");
	writeFileSync(join(projectDir, "settings.txt"), "value=base\n", "utf8");
	git(projectDir, ["add", ".gitignore", "settings.txt"]);
	git(projectDir, ["commit", "--quiet", "-m", "initial"]);
	const worktree = createAutomationWorktree({
		projectDir,
		taskId: "task-native-merge-conflict",
		runId: "run-native-merge-conflict",
		workflowId: "builder",
		owner: "test-owner",
	});
	commitFile(worktree.metadata.workspaceDir, "settings.txt", "value=branch\n", "branch setting");
	commitFile(projectDir, "settings.txt", "value=canonical\n", "canonical setting");
	return { projectDir, worktree };
}

function makeRequest(workspaceDir: string): MergeGateResolverRequest {
	return {
		workspaceDir,
		attempt: 1,
		conflicts: [
			{
				path: "src/conflict.ts",
				kind: "text",
				reason: "both modified",
			},
		],
		previousValidation: null,
	};
}

function registerHarness(
	toolControl: AgentHarness["toolControl"] = "kota",
	name = "test-harness",
): ReturnType<typeof vi.fn> {
	const run = vi.fn(async () => ({
		text: "resolved conflict",
		streamedText: "resolved conflict",
		turns: 1,
		isError: false,
	}));
	registerAgentHarness({
		name,
		description: "test harness",
		supportsMultiTurn: true,
		supportedHookKinds: ["preRun", "postRun"],
		askOwnerToolName: null,
		emitsAgentMessageStream: false,
		toolControl,
		run,
	});
	return run;
}

afterEach(() => {
	clearAgentHarnessRegistryForTest();
	vi.restoreAllMocks();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("createMergeConflictResolver", () => {
	it("runs with a resolver-specific file tool allowlist and conflict-path guard", async () => {
		const workspaceDir = makeWorkspace();
		const run = registerHarness();
		const resolver = createMergeConflictResolver({
			runDirPath: join(workspaceDir, ".kota/runs/test-run"),
			workflowName: "builder",
			runId: "test-run",
			agentContract: mergeResolverContract("test-harness"),
			runAgentHarness,
		});

		await expect(resolver(makeRequest(workspaceDir))).resolves.toEqual({
			resolved: true,
			summary: "resolved conflict",
		});

		expect(run).toHaveBeenCalledOnce();
		const options = run.mock.calls[0][0] as AgentHarnessRunOptions;
		expect(options).toMatchObject({
			model: TEST_PRESET.tiers.capable,
			maxTurns: 8,
			effort: "xhigh",
			autonomyMode: "autonomous",
			persistSession: false,
			enableFileCheckpointing: false,
		});
		expect(options.askOwner).toBeUndefined();
		expect(options.allowedTools).toEqual([...MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS]);
		expect(options.allowedTools).not.toContain("Bash");
		expect(options.allowedTools).not.toContain("shell");
		expect(options.canUseTool).toEqual(expect.any(Function));

		const canUseTool = options.canUseTool;
		if (!canUseTool) throw new Error("expected resolver canUseTool guard");
		const context = { signal: new AbortController().signal, toolUseId: "tool-1" };

		await expect(
			canUseTool("Read", { file_path: "src/conflict.ts" }, context),
		).resolves.toMatchObject({ behavior: "allow" });
		await expect(
			canUseTool("Edit", { file_path: join(workspaceDir, "src/conflict.ts") }, context),
		).resolves.toMatchObject({ behavior: "allow" });
		await expect(
			canUseTool("file_edit", { path: "src/conflict.ts" }, context),
		).resolves.toMatchObject({ behavior: "allow" });

		await expect(
			canUseTool("Read", { file_path: ".kota/config.json" }, context),
		).resolves.toMatchObject({ behavior: "deny", decisionAttribution: "operator-deny" });
		await expect(
			canUseTool("Read", { file_path: "../outside.txt" }, context),
		).resolves.toMatchObject({ behavior: "deny", decisionAttribution: "operator-deny" });
		await expect(
			canUseTool("Bash", { command: "git status" }, context),
		).resolves.toMatchObject({ behavior: "deny", decisionAttribution: "operator-deny" });
		await expect(
			canUseTool("WebFetch", { url: "https://example.com" }, context),
		).resolves.toMatchObject({ behavior: "deny", decisionAttribution: "operator-deny" });
	});

	it("returns a safe unresolved result before invoking a native-tool harness", async () => {
		const workspaceDir = makeWorkspace();
		const run = registerHarness("native", "codex");
		const runDirPath = join(workspaceDir, ".kota/runs/test-run");
		const resolver = createMergeConflictResolver({
			runDirPath,
			workflowName: "builder",
			runId: "test-run",
			agentContract: mergeResolverContract("codex"),
			runAgentHarness,
		});

		await expect(resolver(makeRequest(workspaceDir))).resolves.toMatchObject({
			resolved: false,
			summary: expect.stringMatching(/was not dispatched.*bounded conflict-file guard/),
		});
		expect(run).not.toHaveBeenCalled();
		const artifact = readFileSync(join(runDirPath, "merge-conflict-resolver-attempts.jsonl"), "utf8");
		expect(JSON.parse(artifact)).toMatchObject({
			resolved: false,
			isError: false,
			subtype: "unsupported-tool-control",
		});
	});

	it("leaves a native-tool text conflict pending instead of failing the builder merge step", async () => {
		const { projectDir, worktree } = makeMergeConflictFixture();
		const run = registerHarness("native", "codex");
		const resolver = createMergeConflictResolver({
			runDirPath: join(projectDir, ".kota/runs/run-native-merge-conflict"),
			workflowName: "builder",
			runId: worktree.metadata.runId,
			agentContract: mergeResolverContract("codex"),
			runAgentHarness,
		});

		const result = await mergeAutomationWorktree({
			projectDir,
			taskId: worktree.metadata.taskId,
			runId: worktree.metadata.runId,
			validationCommand: ["node", "-e", "process.exit(0)"],
			resolver,
			maxResolutionAttempts: 2,
		});

		expect(result).toMatchObject({
			status: "pending-conflict",
			reason: expect.stringMatching(/was not dispatched.*pending for recovery review/),
			resolutionAttempts: 1,
			validation: null,
		});
		expect(run).not.toHaveBeenCalled();
		expect(
			inspectAutomationWorktree({
				projectDir,
				taskId: worktree.metadata.taskId,
				runId: worktree.metadata.runId,
			}).metadata,
		).toMatchObject({
			state: "pending-merge",
			stateReason: expect.stringMatching(/was not dispatched/),
		});
	});

	it("fails closed before invoking the harness when a conflict path escapes the workspace", async () => {
		const workspaceDir = makeWorkspace();
		const run = registerHarness();
		const resolver = createMergeConflictResolver({
			runDirPath: join(workspaceDir, ".kota/runs/test-run"),
			workflowName: "builder",
			runId: "test-run",
			agentContract: mergeResolverContract("test-harness"),
			runAgentHarness,
		});
		const request = makeRequest(workspaceDir);
		request.conflicts[0].path = "../secret.txt";

		await expect(resolver(request)).rejects.toThrow(/escapes resolver workspace/);
		expect(run).not.toHaveBeenCalled();
	});
});
