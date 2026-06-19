---
id: task-refactor-workflow-graph-explain
title: refactor workflow graph explain
status: ready
priority: p3
area: modules
task_class: Platform
summary: Split the oversized workflow graph explanation module while preserving behavior.
created_at: 2026-06-19T16:16:59.869Z
updated_at: 2026-06-19T16:16:59.869Z
---

## Problem

`src/modules/workflow-ops/graph/explain.ts` is currently 986 lines. Explanation logic has accumulated enough responsibilities that small changes risk becoming unclear.

## Desired Outcome

Split workflow graph explanation into coherent parser/model/formatting helpers while preserving public exports and explanation output.

## Constraints

- Preserve public exports and explanation semantics.
- Do not change graph interpretation or wording unless a focused fixture proves the current behavior is wrong.
- Read the nearest `AGENTS.md` before touching the workflow-ops graph directory.
- Keep extracted modules cohesive and named by responsibility.

## Done When

- The original file is materially smaller and no longer holds all graph explanation responsibilities.
- Static queries show callers and public exports remain compatible.
- Existing explanation fixtures or sample outputs remain equivalent, or any intentional wording change is documented.
- No leftover duplicate graph explanation paths remain.

## Source / Intent

Owner follow-up on 2026-06-19: queue first-wave refactors for oversized changed production files so autonomous agents can reduce review risk.

## Initiative

N/A - scoped maintenance.

## Acceptance Evidence

- Include `wc -l` before/after for `src/modules/workflow-ops/graph/explain.ts`.
- Include `rg` output or another static query proving public exports/callers are preserved.
- Include a fixture or sample explanation comparison when available.
