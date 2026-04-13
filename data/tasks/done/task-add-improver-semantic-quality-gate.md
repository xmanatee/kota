---
id: task-add-improver-semantic-quality-gate
title: Add semantic quality gate for improver commits
status: done
priority: p1
area: autonomy
summary: Prevent improver from committing no-op, artifact-only, or process-noise changes without a semantic review of whether the run actually improved autonomy.
created_at: 2026-04-13T21:39:00.000Z
updated_at: 2026-04-13T22:08:38.449Z
---

## Problem

One recent improver run committed only `.claude/worktrees/repair-loop-abort-check`
with a meaningful-sounding commit message. A later improver run cleaned it up
and implemented the real repair-loop abort fix. The final state recovered, but
the system allowed a low-value artifact-only commit to land.

Builder has a critic review against a concrete task. Improver does not have an
equivalent semantic gate for its looser autonomy-improvement scope, so
mechanical checks can pass even when the diff does not actually improve the
autonomy layer.

## Desired Outcome

Improver runs are reviewed for semantic value before commit. The gate should
catch empty diffs, stale scratch artifacts, misleading commit messages,
documentation-only churn that does not address an observed issue, and changes
that do not connect to run-outcome evidence or current autonomy problems.

## Constraints

- Do not force improver into a rigid checklist or mandatory evidence artifact.
- Do not require a fixed set of logs; allow the reviewer to inspect run data,
  diffs, tasks, knowledge, and repo state as needed.
- Keep the gate focused on improver scope and commit quality, not general code
  style or mechanical test results.
- Preserve improver's ability to make broad but coherent autonomy changes when
  the evidence supports them.

## Done When

- Improver has a semantic review/check before commit that can fail low-value or
  misleading changes even when build, lint, typecheck, and tests pass.
- The check explicitly catches artifact-only commits like `.claude/worktrees/*`
  and empty/no-op autonomy changes.
- A failed semantic review sends the agent back through repair or leaves the
  work uncommitted instead of landing noise.
- Tests cover at least one low-value improver diff and one valid autonomy
  improvement diff.
