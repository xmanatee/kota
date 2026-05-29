---
id: task-security-review-workflow-trial-mode-does-not-block
title: Security review: Workflow trial mode does not block tools whose declared effect is `process-env`, so a trial workflow can run `get_secret` and mutate the daemon process environment despite trial mode being intended to isolate side effects.
status: done
priority: p2
area: security
summary: Workflow trial mode does not block tools whose declared effect is `process-env`, so a trial workflow can run `get_secret` and mutate the daemon process environment despite trial mode being intended to isolate side effects.
created_at: 2026-05-29T01:23:57.307Z
updated_at: 2026-05-29T01:42:39Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/workflow-ops/execution/trial.ts
claim: Workflow trial mode does not block tools whose declared effect is `process-env`, so a trial workflow can run `get_secret` and mutate the daemon process environment despite trial mode being intended to isolate side effects.

## Desired Outcome

Treat `process-env` effects as live side effects in workflow trial mode, blocking them before execution in both tool steps and agent tool guards, with a regression proving a `process-env` tool cannot mutate `process.env` during a trial run.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-29T01-16-37-722Z-security-review-52hfaq.

finding id: workflow-trial-allows-process-env-secret-injection
candidate id: secret-handling:src/modules/secrets/client.ts:13
verdict: confirmed
rationale: Confirmed. The secrets module registers get_secret with credentialInjectionEffect, whose effect is kind write and scope process-env, and the runner mutates process.env in src/modules/secrets/index.ts:75-76. Workflow trial blocking in src/modules/workflow-ops/execution/trial.ts:197-218 blocks destructive, external-network, operator-surface, daemon-state writes, and unscoped local-fs writes, but has no process-env branch. Both runTrialTool and createTrialAgentToolGuard rely on that same predicate before allowing execution, so process-env tools can run during trial mode.

Evidence:

- src/modules/secrets/index.ts:75 - process.env[name] = value;
- src/core/tools/effect.ts:105 - export function credentialInjectionEffect(): ToolEffect {
- src/core/tools/effect.ts:108 - scope: "process-env",
- src/modules/workflow-ops/execution/trial.ts:205 - if (effect.scope === "external-network" || effect.scope === "operator-surface") {
- src/modules/workflow-ops/execution/trial.ts:208 - if (effect.scope === "daemon-state" && effect.kind !== "read") {
- src/modules/workflow-ops/execution/trial.ts:271 - const result = await executeTool(name, scoped.input);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Final Verification

- `pnpm vitest run src/modules/workflow-ops/execution/trial.test.ts -t process-env`
  passed: 2 tests passed, 13 skipped.
- `pnpm exec biome check src/modules/workflow-ops/execution/trial.ts
  src/modules/workflow-ops/execution/trial.test.ts` passed.
- `pnpm typecheck` passed.
- `node --conditions=source --import tsx src/validate-queue.ts --min-ready 0`
  passed after staging the task move.
- The broader `pnpm vitest run src/modules/workflow-ops/execution/trial.test.ts`
  reached the new tests but failed in existing local trial fallback cases because
  this sandbox cannot load all project modules cleanly (`chmod ~/.kota` denied,
  followed by duplicate tool registrations). The focused regression command
  covers the changed process-env boundary.
