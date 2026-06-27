import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AgentHarness,
	type AgentHarnessRunOptions,
	clearAgentHarnessRegistryForTest,
	registerAgentHarness,
} from "#core/agent-harness/index.js";
import type { MergeGateResolverRequest } from "#modules/git/worktree-merge-gate.js";
import {
	createMergeConflictResolver,
	MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS,
} from "./merge-conflict-resolver.js";

const tempDirs: string[] = [];

function makeWorkspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "kota-merge-resolver-"));
	tempDirs.push(dir);
	return dir;
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

function registerHarness(toolControl: AgentHarness["toolControl"] = "kota"): ReturnType<typeof vi.fn> {
	const run = vi.fn(async () => ({
		text: "resolved conflict",
		streamedText: "resolved conflict",
		turns: 1,
		isError: false,
	}));
	registerAgentHarness({
		name: "test-harness",
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
			harnessName: "test-harness",
		});

		await expect(resolver(makeRequest(workspaceDir))).resolves.toEqual({
			resolved: true,
			summary: "resolved conflict",
		});

		expect(run).toHaveBeenCalledOnce();
		const options = run.mock.calls[0][0] as AgentHarnessRunOptions;
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

	it("fails closed before invoking a harness that cannot route KOTA tool controls", async () => {
		const workspaceDir = makeWorkspace();
		const run = registerHarness("native");
		const resolver = createMergeConflictResolver({
			runDirPath: join(workspaceDir, ".kota/runs/test-run"),
			workflowName: "builder",
			runId: "test-run",
			harnessName: "test-harness",
		});

		await expect(resolver(makeRequest(workspaceDir))).rejects.toThrow(
			/requires KOTA-routable tool control/,
		);
		expect(run).not.toHaveBeenCalled();
	});

	it("fails closed before invoking the harness when a conflict path escapes the workspace", async () => {
		const workspaceDir = makeWorkspace();
		const run = registerHarness();
		const resolver = createMergeConflictResolver({
			runDirPath: join(workspaceDir, ".kota/runs/test-run"),
			workflowName: "builder",
			runId: "test-run",
			harnessName: "test-harness",
		});
		const request = makeRequest(workspaceDir);
		request.conflicts[0].path = "../secret.txt";

		await expect(resolver(request)).rejects.toThrow(/escapes resolver workspace/);
		expect(run).not.toHaveBeenCalled();
	});
});
