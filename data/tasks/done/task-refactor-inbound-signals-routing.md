---
id: task-refactor-inbound-signals-routing
title: refactor inbound signals routing
status: done
priority: p3
area: modules
task_class: Platform
summary: Split the oversized inbound signal routing module while preserving behavior.
created_at: 2026-06-19T16:17:04.012Z
updated_at: 2026-06-20T16:03:28.000Z
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

- `wc -l src/modules/inbound-signals/routing.ts src/modules/inbound-signals/routing-*.ts`: `routing.ts` changed from 829 lines before to 20 lines after; extracted helpers are `routing-batch.ts` 70, `routing-constants.ts` 24, `routing-dispatch.ts` 203, `routing-matching.ts` 75, `routing-payloads.ts` 123, `routing-status.ts` 40, `routing-types.ts` 146, `routing-validation.ts` 237.
- `rg 'from "#modules/inbound-signals/routing\.js"|from "\./routing\.js"' src -g '*.ts'` shows existing callers still import the stable public routing surface through `routing.js`.
- `rg 'export \{ dispatchInboundSignalRoute \}|export \{ inboundSignalRoutingStatus, projectRouteStatus \}|export type \{|export \{ validateInboundSignalRoutingConfig \}' src/modules/inbound-signals/routing.ts` shows the same public functions and types are still re-exported.
- `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/inbound-signals/inbound-signals.test.ts` passed: 15 tests.
- `pnpm exec biome check src/modules/inbound-signals/routing.ts src/modules/inbound-signals/routing-batch.ts src/modules/inbound-signals/routing-constants.ts src/modules/inbound-signals/routing-dispatch.ts src/modules/inbound-signals/routing-matching.ts src/modules/inbound-signals/routing-payloads.ts src/modules/inbound-signals/routing-status.ts src/modules/inbound-signals/routing-types.ts src/modules/inbound-signals/routing-validation.ts` passed.
- `pnpm typecheck` passed.
