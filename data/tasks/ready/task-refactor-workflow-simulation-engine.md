---
id: task-refactor-workflow-simulation-engine
title: refactor workflow simulation engine
status: ready
priority: p3
area: modules
task_class: Platform
summary: Split the oversized workflow simulation engine while preserving behavior.
created_at: 2026-06-19T16:17:12.945Z
updated_at: 2026-06-19T16:17:12.945Z
---

## Problem

`src/modules/workflow-ops/simulation/engine.ts` is currently 625 lines. Simulation engine responsibilities are large enough that future changes can become too broad or leave unclear leftovers.

## Desired Outcome

Split workflow simulation engine responsibilities into cohesive units while preserving simulation behavior, public exports, and fixture compatibility.

## Constraints

- Preserve public exports and simulation semantics.
- Do not change simulation outcomes without focused fixture evidence and a documented reason.
- Read the nearest `AGENTS.md` before touching workflow simulation code.
- Keep engine orchestration readable after extraction.

## Done When

- The original file is materially smaller and responsibilities are separated.
- Static queries show callers and public exports remain compatible.
- Existing simulation fixtures or focused sample runs remain equivalent.
- No duplicate engine paths or unused extracted helpers remain.

## Source / Intent

Owner follow-up on 2026-06-19: add first-wave refactor tasks for the oversized production files rather than manually refactoring them in this turn.

## Initiative

N/A - scoped maintenance.

## Acceptance Evidence

- Include `wc -l` before/after for `src/modules/workflow-ops/simulation/engine.ts`.
- Include `rg` output or another static query proving public exports/callers are preserved.
- Include focused simulation fixture/probe output when available.
