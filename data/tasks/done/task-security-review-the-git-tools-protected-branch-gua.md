---
id: task-security-review-the-git-tools-protected-branch-gua
title: Security review: The git tool's protected-branch guard can be bypassed with a force refspec such as `origin +HEAD:main`. The operation is also classified as a local write, so the default moderate-risk policy allows this destructive remote update without approval.
status: done
priority: p1
area: security
task_class: Safety
summary: The git tool's protected-branch guard can be bypassed with a force refspec such as `origin +HEAD:main`. The operation is also classified as a local write, so the default moderate-risk policy allows this destructive remote update without approval.
created_at: 2026-07-24T11:35:59.566Z
updated_at: 2026-07-24T16:41:28.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/git/git.ts
claim:

> The git tool's protected-branch guard can be bypassed with a force refspec such as `origin +HEAD:main`. The operation is also classified as a local write, so the default moderate-risk policy allows this destructive remote update without approval.

## Desired Outcome

> Parse push destinations and force semantics rather than checking only two flags and the current branch. Reject non-lease forced updates targeting main/master regardless of refspec syntax or source branch, and classify push operations as external-network mutations with dangerous classification for forced updates. Add bare-remote regression tests for positive refspecs and feature-to-main force pushes.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-24T11-24-39-395Z-security-review-h4mafq.

finding id: git-protected-force-push-bypass
candidate id: auth-approval-boundary:src/modules/git/git.test.ts:285
verdict: confirmed
rationale:

> src/modules/git/git.ts:175-185 checks only exact --force/-f flags and otherwise forwards refspecs unchanged. A fresh disposable bare-remote probe confirmed that origin +HEAD:main rewrites remote main. src/modules/git/index.ts:65 classifies every git operation as a local write, which maps to moderate risk and default allow.

Evidence:

Evidence 1:



path: src/modules/git/git.ts

line: 175

excerpt:



> if (parts.some((p) => p === "--force" || p === "-f")) {

Evidence 2:



path: src/modules/git/git.ts

line: 176

excerpt:



> const branch = await getCurrentBranch(context);

Evidence 3:



path: src/modules/git/git.ts

line: 185

excerpt:



> const result = await git(["push", ...parts], context);

Evidence 4:



path: src/modules/git/index.ts

line: 65

excerpt:



> effect: localWriteEffect(),

Evidence 5:



path: src/core/tools/guardrails.ts

line: 45

excerpt:



> moderate: "allow",

Evidence 6:



path: .kota/runs/2026-07-24T11-24-39-395Z-security-review-h4mafq/git-push-guard-probe.json

line: 6

excerpt:



> "gitOutput": "+ ca21b6d...77c04fa HEAD -> main (forced update)",

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source ./node_modules/.bin/vitest run src/core/tools/tool-runner.test.ts src/core/tools/tool-runner-permission.test.ts src/core/tools/guardrails.test.ts src/core/tools/guardrails-resolved-effects.test.ts src/modules/git/index.test.ts src/modules/git/git.test.ts src/modules/git/git-push-regression.test.ts src/modules/git/push-safety.test.ts src/core/modules/module-loader.test.ts src/modules/workflow-ops/execution/trial.test.ts src/docs-surface.test.ts src/strict-types-policy.integration.test.ts --configLoader runner --silent=true` — 282 tests passed, including `--repo`, separate option values, `@`, `heads/main`, and abbreviated-option regressions.
- `./node_modules/.bin/biome check src/`, `NODE_OPTIONS=--conditions=source ./node_modules/.bin/tsc --noEmit`, and `node --conditions=source --import tsx src/validate-queue.ts` — passed.
- The severe source-size gate passed. It retained advisory warnings for three pre-existing oversized core files touched by small protocol changes: `module-loader-load-phases.ts` (+3 lines), `module-types.ts` (+7), and `guardrails-classify.ts` (+21).
- The full suite reached 12,020 passing tests. Its remaining failures were environmental: pnpm registry signatures could not be fetched, and the sandbox made the worktree's real Git index read-only; the docs-surface failure found during that run was fixed and rechecked.
