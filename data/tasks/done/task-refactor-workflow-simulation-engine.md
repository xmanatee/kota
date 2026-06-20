---
id: task-refactor-workflow-simulation-engine
title: refactor workflow simulation engine
status: done
priority: p3
area: modules
task_class: Platform
summary: Split the oversized workflow simulation engine while preserving behavior.
created_at: 2026-06-19T16:17:12.945Z
updated_at: 2026-06-20T01:50:22.000Z
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

- `wc -l src/modules/workflow-ops/simulation/engine.ts`: before 625 lines, after 149 lines.
- `wc -l` after extraction: `events.ts` 182, `batches.ts` 83, `idempotency-preview.ts` 128, `outcomes.ts` 84, `dry-runs.ts` 50.
- `rg "from \"\\./engine\\.js\"|from \"\\./simulation/engine\\.js\"|eventEnvelopePayloadForFixture|simulateAutomation" src/modules/workflow-ops -n` shows existing callers still import `simulateAutomation` from `./engine.js` / `./simulation/engine.js`, and `engine.ts` still re-exports `eventEnvelopePayloadForFixture`.
- `NODE_OPTIONS=--conditions=source pnpm exec vitest run src/modules/workflow-ops/simulation/engine.test.ts src/modules/workflow-ops/simulation/cli.test.ts src/modules/workflow-ops/simulation/routes.test.ts` passed: 3 test files, 11 tests.
- `pnpm exec biome check src/modules/workflow-ops/simulation` passed.
- `pnpm typecheck` passed.
