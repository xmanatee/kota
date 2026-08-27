---
status: done
---

# Security review: The workflow shell teardown guard only denies a narrow set of command forms, so direct destructive equivalents such as `git restore .`, `git checkout -- src`, and `terraform apply -destroy -auto-approve` fall through as allowed workflow-agent shell calls.

## Problem

The security-review workflow confirmed that
`classifyWorkflowShellTeardownCommand` denied only a narrow set of workflow
shell teardown forms. Direct destructive equivalents such as `git restore .`,
`git checkout -- src`, and `terraform apply -destroy -auto-approve` were not
classified before workflow-agent shell execution.

## Desired Outcome

The workflow shell teardown guard denies common direct destructive equivalents,
especially `terraform apply -destroy` and Git worktree-discard forms such as
`git restore .` and `git checkout -- <path>`, while preserving benign branch
checkout and read-only commands.

## Constraints

- The confirmed security claim was fixed in code rather than hidden or
  reclassified.
- Authorization, approval, tool-risk, secret-handling, and injection-defense
  boundaries were not weakened.

## Outcome

The classifier now treats Git path checkout and restore commands as local-work
teardown, including `git checkout -- <path>` and `git restore <path>`.

Terraform `apply` commands with a truthy `-destroy` / `--destroy` flag are now
classified as infrastructure teardown. Normal branch checkout, `git restore
--help`, plain `terraform apply`, and `terraform apply -destroy=false` remain
allowed by regression coverage.

## Done When

- The cited vulnerability is fixed in `src/core/agent-harness/guards.ts`.
- Focused regression coverage guards the classifier and workflow-agent guard
  boundary.
- The task records the final verification commands.

## Verification

- `pnpm test src/core/agent-harness/guard-command-classifiers.test.ts` passed.
- `pnpm test src/core/agent-harness/guards.test.ts` passed.
- `pnpm exec tsc --noEmit --pretty false` passed.
- `pnpm run lint` passed.
- `pnpm run validate-tasks` passed after `git add -A` staged the task move.

## Source / Intent

Created by security-review workflow run
`2026-06-22T16-40-20-747Z-security-review-k2b3dd`.

Finding id:
`workflow-shell-teardown-guard-misses-direct-destructive-equivalents`.

The confirmed claim was fixed without weakening authorization, approval,
tool-risk, secret-handling, or injection-defense boundaries.

## Acceptance Evidence

- Regression tests in `src/core/agent-harness/guard-command-classifiers.test.ts`
  and `src/core/agent-harness/guards.test.ts` cover the fixed boundary.
