---
id: task-structural-audit-remaining-issues
title: Audit remaining structural and modularization issues in the codebase
status: backlog
priority: p2
area: architecture
summary: Review the codebase at a high level to identify concepts, abstractions, and structural elements that are unnecessary, misplaced, or should be modularized, then propose concrete next steps for any real issues found.
created_at: 2026-04-10T12:47:56Z
updated_at: 2026-04-10T12:47:56Z
---

## Problem

Despite significant modularization work (core shrink, module boundary checks,
source tree cleanup, per-directory layout migration, capability tool moves),
the owner still observes structural issues on the surface. Specific questions
raised:

- Is `architect` a standalone concept or should it be expressed through
  existing abstractions (skills, tools)?
- Should `memory` be a module rather than core?
- Is the `schema/` top-level directory still needed?
- Should `workflow-testing` live under `workflow/testing`?
- Is too much non-modularized code sitting directly under `src/` (e.g. vercel,
  CLI, module-discovery/factory/load)?

Some of these may already be resolved by recent work. The audit should verify
current state, not assume the questions are still valid.

## Desired Outcome

A high-level review (not deep implementation reading) that:
1. Checks each flagged concern against the current codebase state.
2. Identifies which issues are already resolved and which remain.
3. For remaining issues, proposes concrete tasks or confirms they are
   intentional design choices with clear reasoning.

## Constraints

- Stay high-level — do not dig into implementation details.
- Do not create tasks for issues that are already addressed.
- If something looks wrong but has a good reason, document the reason rather
  than proposing a change.
- This is investigative work. Output should be a clear summary with
  actionable next steps, not a refactoring PR.

## Done When

- Each flagged concern has been checked against current state.
- Remaining real issues have follow-up tasks or documented rationale.
- No phantom issues are carried forward from the original capture.
