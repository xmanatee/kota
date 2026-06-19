---
id: task-refactor-inbound-signals-routing
title: refactor inbound signals routing
status: ready
priority: p3
area: modules
task_class: Platform
summary: Split the oversized inbound signal routing module while preserving behavior.
created_at: 2026-06-19T16:17:04.012Z
updated_at: 2026-06-19T16:17:04.012Z
---

## Problem

`src/modules/inbound-signals/routing.ts` is currently 829 lines. Routing decisions and supporting helpers are concentrated in one large file, increasing the chance that agents miss conventions or leave leftovers.

## Desired Outcome

Split inbound signal routing into smaller routing, matching, and support units while preserving route behavior and public exports.

## Constraints

- Preserve public exports and route selection semantics.
- Do not broaden or narrow routing behavior without explicit fixture evidence.
- Read the nearest `AGENTS.md` before touching inbound-signals code.
- Avoid hidden fallback paths or duplicate routing implementations after extraction.

## Done When

- The original file is materially smaller and responsibilities are clearly separated.
- Static queries show callers and public exports remain compatible.
- Existing routing fixtures or focused sample probes remain equivalent.
- No unused extracted modules or duplicate route tables remain.

## Source / Intent

Owner follow-up on 2026-06-19: create explicit autonomous-agent refactor work for the oversized files identified in the assessment.

## Initiative

N/A - scoped maintenance.

## Acceptance Evidence

- Include `wc -l` before/after for `src/modules/inbound-signals/routing.ts`.
- Include `rg` output or another static query proving public exports/callers are preserved.
- Include a focused routing fixture/probe or explain why none exists and what static evidence replaced it.
