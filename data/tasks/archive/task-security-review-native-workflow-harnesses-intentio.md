---
status: done
---

# Security review: Native workflow harnesses intentionally discard the resolved scope policy and enforce only its autonomy cap. Because scope-policy dimensions are independent, an autonomous Codex step can still receive a workspace-write sandbox when writes.mode is none or path-bounded, and outbound networking remains allowed when externalEffects denies or requires confirmation. Restrictive policy is therefore not applied or rejected at launch.

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/codex-agent-harness/adapter.ts
claim:

> Native workflow harnesses intentionally discard the resolved scope policy and enforce only its autonomy cap. Because scope-policy dimensions are independent, an autonomous Codex step can still receive a workspace-write sandbox when writes.mode is none or path-bounded, and outbound networking remains allowed when externalEffects denies or requires confirmation. Restrictive policy is therefore not applied or rejected at launch.

## Desired Outcome

> Reject native-harness launches whenever any effective scope-policy dimension cannot be enforced, or compile writes, modules/tools, external effects, and confirmation requirements into a fail-closed native boundary. Add tests using maxMode autonomous with writes none/path restrictions and networkRead/networkWrite deny to prove the native process cannot perform those effects.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-03T22-34-27-866Z-security-review-nx0r95.

finding id: native-harness-strips-resolved-scope-policy
candidate id: auth-approval-boundary:src/modules/codex-agent-harness/adapter.ts:156
verdict: confirmed
rationale:

> routeKotaToolControlOptions deliberately removes scopePolicy for native harnesses, and the existing capability test explicitly expects this. Only autonomy.maxMode is applied; independent write, module, external-effect, and confirmation restrictions are neither compiled into the Codex sandbox nor rejected. An autonomous policy with writes.mode none or denied networking therefore still launches with workspace writes and unrestricted network access.

Evidence:

Evidence 1:

path: src/core/workflow/steps/step-executor-agent-run-options.ts

line: 102

excerpt:

> scopePolicy is supplied only through routeKotaToolControlOptions alongside allowedTools, disallowedTools, and canUseTool.

Evidence 2:

path: src/core/agent-harness/runner.ts

line: 153

excerpt:

> if (!shouldRouteKotaToolControl(harness)) return {};

Evidence 3:

path: src/modules/codex-agent-harness/adapter.ts

line: 191

excerpt:

> codexSandboxMode returns read-only only for passive mode; every other supported mode becomes workspace-write.

Evidence 4:

path: src/modules/codex-agent-harness/adapter.ts

line: 221

excerpt:

> The Codex adapter declares toolControl: "native", causing the resolved policy to be removed before launch.

Evidence 5:

path: src/core/agent-harness/machine-authority-sandbox.ts

line: 69

excerpt:

> The macOS profile begins with (allow default) and constrains filesystem writes to writable roots, but contains no network-policy enforcement.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Final Verification

- `pnpm test src/core/agent-harness/runner.test.ts src/core/agent-harness/runner-scope-policy.test.ts src/core/workflow/steps/step-executor-agent-capability.test.ts src/core/workflow/run-executor-scope-policy.test.ts src/core/tools/delegate-turn.test.ts src/core/tools/handoff-agent-input-policy.test.ts src/modules/codex-agent-harness/adapter.test.ts src/modules/gemini-cli-agent-harness/adapter.test.ts src/modules/antigravity-cli-agent-harness/adapter.test.ts` — 70 tests passed.
- `pnpm test src/modules/claude-agent-harness/executor.test.ts src/core/events/event-bus.test.ts src/core/loop/instruction-files.test.ts src/modules/daemon-ops/index.test.ts src/daemon.integration.test.ts src/task-files.test.ts src/workflow-runtime.integration.test.ts src/workflow-validation.integration.test.ts` — 396 tests passed.
- `pnpm typecheck`, `pnpm build`, focused Biome checks, and `pnpm validate-tasks` passed. Repo-wide `pnpm lint` completed with pre-existing warnings outside the changed files and no errors.
- Post-check repair: 73 focused harness and policy tests passed after splitting oversized sources; `pnpm typecheck` passed, and all 216 tests in the six files reported by the failed broad test check passed in isolation.
- Post-check repair attempt 2 corrected the obsolete Vitest `maxForks` setting to the supported `maxWorkers` setting, making the intended four-worker resource cap effective. The 11 reported CLI failures then passed alongside the changed security boundary: `pnpm test src/cli.test.ts src/module-cli-commands.integration.test.ts src/core/agent-harness/runner.test.ts src/core/agent-harness/runner-cancellation.test.ts src/core/agent-harness/runner-token-budget.test.ts src/core/agent-harness/runner-scope-policy.test.ts src/core/workflow/steps/step-executor-agent-capability.test.ts src/core/workflow/steps/step-executor-agent-native-scope-policy.test.ts src/core/workflow/run-executor-scope-policy.test.ts src/core/tools/delegate-turn.test.ts src/core/tools/handoff-agent-input-policy.test.ts src/modules/codex-agent-harness/adapter.test.ts src/modules/gemini-cli-agent-harness/adapter.test.ts src/modules/antigravity-cli-agent-harness/adapter.test.ts` — 14 files and 108 tests passed.
- A repo-wide `pnpm test` rerun confirmed the CLI timeout failures are gone and completed 1,203 passing files / 12,374 passing tests. Its remaining 53 failed files / 236 failed tests are not a valid code signal inside the native sandbox: the failure set is rooted in denied temp-parent traversal or writes (`EPERM`), denied loopback connects, and macOS `sandbox_apply: Operation not permitted`, before the affected test behavior can run.
- Post-check repair attempt 3 closed the direct workflow context bypass: `ctx.runAgentHarness` now injects live effective scope authority for native as well as KOTA-hosted harnesses, so unsupported native adapters fail before launch. `pnpm test src/core/workflow/steps/step-context-native-scope-policy.test.ts src/core/workflow/steps/step-context-scope-policy.test.ts src/core/agent-harness/runner-scope-policy.test.ts src/core/workflow/steps/step-executor-agent-native-scope-policy.test.ts src/core/workflow/run-executor-hosted-scope-policy.test.ts` — 5 files and 13 tests passed, including direct write-disabled and network-denied policies; `pnpm typecheck`, `pnpm validate-tasks`, and focused Biome checks passed.
