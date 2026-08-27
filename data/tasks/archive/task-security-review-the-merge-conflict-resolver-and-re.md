---
status: done
---

# Security review: The merge-conflict resolver and reviewer launch an agent harness from the mutable builder worktree. When the openai-tools harness is selected, startup automatically loads the worktree's ignored .kota/mcp.json and connects every configured server before tool restrictions are applied. An untrusted builder can therefore plant an untracked stdio MCP configuration that spawns an arbitrary host process during later conflict resolution, outside the agent write scope and durable Git diff.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/workflows/builder/merge-conflict-resolution-review.ts
claim:

> The merge-conflict resolver and reviewer launch an agent harness from the mutable builder worktree. When the openai-tools harness is selected, startup automatically loads the worktree's ignored .kota/mcp.json and connects every configured server before tool restrictions are applied. An untrusted builder can therefore plant an untracked stdio MCP configuration that spawns an arbitrary host process during later conflict resolution, outside the agent write scope and durable Git diff.

## Desired Outcome

> Disable project-configured MCP bootstrap for internal resolver and reviewer invocations, or bind it to runtime-authenticated configuration outside agent-writable worktrees. Any permitted MCP subprocess must run under the workflow's filesystem and network sandbox. Add a regression test proving that a planted worktree-local .kota/mcp.json cannot execute during conflict resolution or review.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-23T08-38-48-590Z-security-review-wwxpdn.

finding id: security-review-worktree-mcp-bootstrap-before-guards
candidate id: mcp-transport:src/modules/autonomy/workflows/builder/merge-conflict-resolution-review.ts:71
verdict: confirmed
rationale:

> Both resolver and reviewer set the mutable builder worktree as the harness cwd. The openai-tools adapter loads cwd/.kota/mcp.json and initializes every configured MCP server before allowedTools or canUseTool govern tool execution. Stdio initialization directly spawns the configured command with host permissions. Because the builder has unrestricted write scope and worktree-local .kota content is ignored by Git, a planted configuration can trigger an untracked host process despite the resolver's narrow write scope or the reviewer's deny-all scope.

Evidence:

Evidence 1:

path: src/modules/autonomy/workflows/builder/workflow.ts

line: 70

excerpt:

> // Builder ships arbitrary code changes — its scope is explicitly
> // unrestricted rather than absence-means-unlimited.
> writeScope: [],

Evidence 2:

path: .gitignore

line: 8

excerpt:

> **/.kota/
> !/.kota/
> /.kota/*

Evidence 3:

path: src/modules/autonomy/workflows/builder/merge-conflict-resolution-review.ts

line: 155

excerpt:

> const reviewOptions: AgentHarnessRunOptions = {
>   ...resolved.options,
>   cwd: input.request.workspaceDir,
>   agentWriteScope: "deny-all",
>   systemPrompt: MERGE_CONFLICT_REVIEW_SYSTEM_PROMPT,
>   ...(routedTools ? { allowedTools: REVIEW_ALLOWED_TOOLS } : {}),
> };
> const response = await input.runAgentHarness(

Evidence 4:

path: src/modules/openai-tools-agent-harness/adapter.ts

line: 95

excerpt:

> const mcpManager = await initializeMcpManager(options);
> try {
>   const system = mode.systemPrompt(options.systemPrompt);

Evidence 5:

path: src/modules/openai-tools-agent-harness/adapter-runtime.ts

line: 38

excerpt:

> const projectConfig = McpManager.loadConfig(projectDir);

Evidence 6:

path: src/core/mcp/manager.ts

line: 571

excerpt:

> /** Load MCP config from .kota/mcp.json in the given directory. */
> static loadConfig(cwd?: string): McpConfig | null {
>   const dir = cwd || process.cwd();
>   const configPath = join(dir, ".kota", "mcp.json");

Evidence 7:

path: src/core/mcp/client-stdio-runtime.ts

line: 39

excerpt:

> this.proc = spawn(this.transport.command, this.transport.args ?? [], {
>   stdio: ["pipe", "pipe", "pipe"],
>   env: buildMcpStdioSubprocessEnv(this.transport.env),
> });

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `pnpm exec vitest run --configLoader runner --silent=true src/modules/autonomy/workflows/builder/merge-conflict-resolver.test.ts src/modules/autonomy/workflows/builder/merge-conflict-resolver-native.test.ts src/modules/autonomy/workflows/builder/merge-conflict-resolver-native-review.test.ts src/modules/autonomy/workflows/builder/merge-conflict-resolver-native-recovery.test.ts src/modules/openai-tools-agent-harness/adapter.test.ts src/modules/openai-tools-agent-harness/adapter-shared-runner.test.ts src/modules/openai-tools-agent-harness/adapter-mcp-shared-runner.test.ts src/modules/openai-tools-agent-harness/adapter.integration.test.ts` — 8 files and 50 tests pass, including a planted worktree-local `.kota/mcp.json` execution-marker regression.
- `pnpm typecheck` and `pnpm lint` pass.
