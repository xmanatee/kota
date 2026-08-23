import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentHarnessRunOptions } from "#core/agent-harness/index.js";
import {
	createMergeConflictResolver,
	MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS,
} from "./merge-conflict-resolver.js";
import {
	cleanupMergeResolverFixtures,
	makeRequest,
	makeWorkspace,
	mergeResolverContract,
	registerHarness,
	runAgentHarness,
	TEST_PRESET,
	writeTaskContract,
} from "./merge-conflict-resolver-test-support.js";

afterEach(cleanupMergeResolverFixtures);

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
			summary: "resolved conflict within the claimed task scope",
		});
		expect(run).toHaveBeenCalledTimes(2);
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
		expect(options.agentWriteScope).toEqual(["src/conflict.ts"]);
		expect(options.allowedTools).toEqual([...MERGE_CONFLICT_RESOLVER_ALLOWED_TOOLS]);
		expect(options.allowedTools).not.toContain("Bash");
		expect(options.allowedTools).not.toContain("shell");
		expect(options.canUseTool).toEqual(expect.any(Function));
		expect(options.prompt).toContain("## Claimed Task Contract");
		expect(options.prompt).toContain("## Canonical Diff For Conflict Files");
		expect(options.prompt).toContain("canonical change");
		expect(run.mock.calls[1]?.[0]).toMatchObject({
			agentWriteScope: "deny-all",
			allowedTools: ["Read", "file_read", "scaffold_search_read"],
			canUseTool: expect.any(Function),
		});
		expect(run.mock.calls[1]?.[0].prompt).toContain("## Actual Resolved Diff");

		const canUseTool = options.canUseTool;
		if (!canUseTool) throw new Error("expected resolver canUseTool guard");
		const context = { signal: new AbortController().signal, toolUseId: "tool-1" };
		await expect(canUseTool("Read", { file_path: "src/conflict.ts" }, context)).resolves.toMatchObject({ behavior: "allow" });
		await expect(canUseTool("Edit", { file_path: join(workspaceDir, "src/conflict.ts") }, context)).resolves.toMatchObject({ behavior: "allow" });
		await expect(canUseTool("file_edit", { path: "src/conflict.ts" }, context)).resolves.toMatchObject({ behavior: "allow" });
		for (const [tool, input] of [
			["Read", { file_path: ".kota/config.json" }],
			["Read", { file_path: "../outside.txt" }],
			["Bash", { command: "git status" }],
			["WebFetch", { url: "https://example.com" }],
		] as const) {
			await expect(canUseTool(tool, input, context)).resolves.toMatchObject({
				behavior: "deny",
				decisionAttribution: "operator-deny",
			});
		}
	});

	it("dispatches a native-tool harness with exact conflict-file sandbox scope", async () => {
		const workspaceDir = makeWorkspace();
		const run = registerHarness("native", "codex");
		const resolver = createMergeConflictResolver({
			runDirPath: join(workspaceDir, ".kota/runs/test-run"),
			workflowName: "builder",
			runId: "test-run",
			agentContract: mergeResolverContract("codex"),
			runAgentHarness,
		});
		await expect(resolver(makeRequest(workspaceDir))).resolves.toEqual({
			resolved: true,
			summary: "resolved conflict within the claimed task scope",
		});
		expect(run).toHaveBeenCalledTimes(2);
		expect(run.mock.calls[0]?.[0]).toMatchObject({
			agentWriteScope: ["src/conflict.ts"],
			autonomyMode: "autonomous",
		});
		expect(run.mock.calls[1]?.[0]).toMatchObject({
			agentWriteScope: "deny-all",
			autonomyMode: "autonomous",
		});
		expect(run.mock.calls[0]?.[0].allowedTools).toBeUndefined();
		expect(run.mock.calls[0]?.[0].canUseTool).toBeUndefined();
	});

	it("rejects missing acceptance evidence before native dispatch", async () => {
		const workspaceDir = makeWorkspace();
		writeTaskContract(workspaceDir, "- Describe the command, artifact, transcript, screenshot, fixture, or demo that will prove the task is actually done.");
		const run = registerHarness("native", "codex");
		const runDirPath = join(workspaceDir, ".kota/runs/test-missing-evidence");
		const resolver = createMergeConflictResolver({
			runDirPath,
			workflowName: "builder",
			runId: "test-missing-evidence",
			agentContract: mergeResolverContract("codex"),
			runAgentHarness,
		});
		await expect(resolver(makeRequest(workspaceDir))).resolves.toMatchObject({
			resolved: false,
			summary: expect.stringContaining("acceptance evidence is missing"),
		});
		expect(run).not.toHaveBeenCalled();
		expect(JSON.parse(readFileSync(join(runDirPath, "merge-conflict-resolver-attempts.jsonl"), "utf8"))).toMatchObject({ subtype: "missing-acceptance-evidence" });
	});

	it("fails closed when resolved-diff review is not a structured task-scope judgment", async () => {
		const workspaceDir = makeWorkspace();
		const run = registerHarness("native", "codex");
		run.mockImplementationOnce(async (options: AgentHarnessRunOptions) => {
			options.abortQuarantine?.register(() => undefined);
			if (!options.cwd) throw new Error("resolver fixture requires cwd");
			writeFileSync(
				join(options.cwd, "src/conflict.ts"),
				"export const value = 'plausible';\n",
				"utf8",
			);
			return {
				text: "made a plausible edit",
				streamedText: "made a plausible edit",
				turns: 1,
				isError: false,
			};
		});
		run.mockImplementationOnce(async (options: AgentHarnessRunOptions) => {
			options.abortQuarantine?.register(() => undefined);
			return {
				text: "looks good",
				streamedText: "looks good",
				turns: 1,
				isError: false,
			};
		});
		const runDirPath = join(workspaceDir, ".kota/runs/test-invalid-review");
		const resolver = createMergeConflictResolver({
			runDirPath,
			workflowName: "builder",
			runId: "test-invalid-review",
			agentContract: mergeResolverContract("codex"),
			runAgentHarness,
		});

		await expect(resolver(makeRequest(workspaceDir))).resolves.toEqual({
			resolved: false,
			summary: "Merge-resolution review returned invalid structured judgment.",
		});
		expect(
			JSON.parse(
				readFileSync(
					join(runDirPath, "merge-conflict-resolver-attempts.jsonl"),
					"utf8",
				),
			),
		).toMatchObject({
			resolved: false,
			subtype: "invalid-resolution-judgment",
			resolvedDiffTail: expect.stringContaining("plausible"),
		});
	});

	it("fails closed before dispatch when a conflict path escapes the workspace", async () => {
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
