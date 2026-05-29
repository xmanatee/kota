---
id: task-security-review-project-file-backed-secrets-can-be
title: Security review: Project file-backed secrets can be exposed to agents through ordinary filesystem read tools: secrets are stored in `.kota/secrets.json`, only `.kota/daemon-control.json` is protected, `file_read` returns file text after that narrow check, and KOTA-controlled harness adapters pass raw `executeTool` output back to the model without applying `SecretStore.mask`.
status: done
priority: p1
area: security
summary: Project file-backed secrets can be exposed to agents through ordinary filesystem read tools: secrets are stored in `.kota/secrets.json`, only `.kota/daemon-control.json` is protected, `file_read` returns file text after that narrow check, and KOTA-controlled harness adapters pass raw `executeTool` output back to the model without applying `SecretStore.mask`.
created_at: 2026-05-29T03:26:06.359Z
updated_at: 2026-05-29T03:36:11Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/filesystem/protected-paths.ts
claim: Project file-backed secrets can be exposed to agents through ordinary filesystem read tools: secrets are stored in `.kota/secrets.json`, only `.kota/daemon-control.json` is protected, `file_read` returns file text after that narrow check, and KOTA-controlled harness adapters pass raw `executeTool` output back to the model without applying `SecretStore.mask`.

## Desired Outcome

Treat project secret stores and env files as protected project credential paths for all filesystem read/list/search tools, and route KOTA-controlled harness tool results through the shared secret-masking boundary before returning content to models. Add a regression proving `file_read` cannot expose `.kota/secrets.json` or `.env` contents through an agent harness.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-29T03-17-35-099Z-security-review-nu2xgs.

finding id: file-backed-secrets-readable-through-agent-file-tools
candidate id: secret-handling:src/modules/secrets/client.ts:13
verdict: confirmed
rationale: Confirmed. `SecretStore` stores project secrets at `<project>/.kota/secrets.json` and loads `<project>/.env`; filesystem protected paths only include `.kota/daemon-control.json`. `file_read` checks only that helper before returning file text. The `openai-tools` adapter calls the lower-level `executeTool` and copies returned content directly into a `tool_result`; that registry returns the raw runner result. The masking in `tool-runner` is not on this adapter path.

Evidence:

- src/core/config/secrets.ts:37 - this.projectFileProvider = new FileProvider(
- src/core/config/secrets.ts:46 - const projectEnv = new EnvProvider(join(projectDir, ".env"));
- src/modules/secrets/index.ts:41 - "You receive a masked placeholder — never the real value. " +
- src/modules/filesystem/protected-paths.ts:4 - const PROTECTED_PROJECT_FILES = new Set([".kota/daemon-control.json"]);
- src/modules/filesystem/file-read.ts:53 - if (isProtectedProjectPath(filePath)) {
- src/modules/filesystem/file-read.ts:114 - return readText(filePath, input, stats.size);
- src/modules/openai-tools-agent-harness/adapter.ts:267 - const toolResult = await executeTool(call.name, effectiveInput);
- src/modules/openai-tools-agent-harness/adapter.ts:272 - content: toolResult.blocks ? toolResult.blocks : toolResult.content,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/filesystem/file-read.test.ts src/modules/filesystem/grep.test.ts src/modules/filesystem/glob.test.ts src/modules/filesystem/files-overview.test.ts src/modules/filesystem/repo-map.test.ts src/modules/openai-tools-agent-harness/adapter.test.ts` passed: 6 files, 172 tests.
- `pnpm vitest run src/modules/gemini-agent-harness/adapter.test.ts src/modules/vercel-agent-harness/adapter.test.ts src/modules/openai-tools-agent-harness/adapter.test.ts` passed: 3 files, 60 tests.
- `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/core/tools/tool-runner.test.ts` passed: 1 file, 49 tests.
- `pnpm exec biome check src/core/tools/secret-masking.ts src/core/tools/tool-runner.ts src/modules/filesystem/protected-paths.ts src/modules/filesystem/grep.ts src/modules/filesystem/glob.ts src/modules/filesystem/files-overview.ts src/modules/filesystem/repo-map.ts src/modules/openai-tools-agent-harness/adapter.ts src/modules/filesystem/file-read.test.ts src/modules/filesystem/grep.test.ts src/modules/filesystem/glob.test.ts src/modules/filesystem/files-overview.test.ts src/modules/filesystem/repo-map.test.ts src/modules/openai-tools-agent-harness/adapter.test.ts` passed.
- `pnpm exec biome check src/modules/gemini-agent-harness/adapter.ts src/modules/gemini-agent-harness/adapter.test.ts src/modules/vercel-agent-harness/adapter.ts src/modules/vercel-agent-harness/adapter.test.ts` passed.
- `pnpm typecheck` passed.
- `NODE_OPTIONS=--conditions=source node --import tsx src/validate-queue.ts --summary` passed: errors=0 warnings=0.
