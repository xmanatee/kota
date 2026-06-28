---
id: task-resolve-resource-isolation-build-diagnostics
title: Resolve resource-isolation build diagnostics
status: done
priority: p2
area: platform
summary: Builder run 2026-06-28T18-42-51-432Z-builder-1dlez9 completed runtime resource isolation but left source-size warnings for readiness.ts, claude-agent-harness/executor.ts, and daemon-ops/status-cli.ts plus observability-obligation warnings for runtime-sensitive harness/tool files.
created_at: 2026-06-28T20:27:05.895Z
updated_at: 2026-06-28T20:45:00.000Z
---

## Problem

Builder run 2026-06-28T18-42-51-432Z-builder-1dlez9 completed runtime resource isolation but left source-size warnings for readiness.ts, claude-agent-harness/executor.ts, and daemon-ops/status-cli.ts plus observability-obligation warnings for runtime-sensitive harness/tool files.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T20-14-42-832Z-progress-reviewer-4w1ysg.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T20-14-42-832Z-progress-reviewer-4w1ysg.

review verdict: needs-steering
review summary: Needs narrow steering. Balance: Product 0, Safety 1, Platform 4, Meta 0, Unclassified 9. The three committed builds closed their target security/platform/source-size tasks, with no open dead letters or operator-journey risks in the packet, but inspected builder diagnostics show untracked observability and source-size warnings.

Evidence ids:

- event:evtj-000000123543
- git:commit:582864dba7ad
- task:task-add-runtime-resource-isolation-hooks-for-parallel-

## Initiative

Outcome-aware autonomy progress review.

## Result

Resolved by splitting the three oversized cited source surfaces into cohesive module-local helpers:

- `src/core/agent-harness/readiness.ts` now re-exports type declarations and Node/native readiness probes from focused files under `src/core/agent-harness/`.
- `src/modules/claude-agent-harness/executor.ts` now keeps orchestration while SDK message normalization, process spawning, and permission bridging live in focused helper files.
- `src/modules/daemon-ops/status-cli.ts` now owns command registration while status snapshot types, gathering, rendering, and worktree rendering live in focused helper files.

The original commit's observability-obligation gaps were rechecked with an explicit rationale artifact mapping every previously missing runtime-sensitive file to the correct observable evidence boundary.

## Acceptance Evidence

- Source-size before/after line counts are recorded in `.kota/runs/2026-06-28T20-30-18-343Z-builder-uy1cbi/source-size-evidence.txt`; staged source-size recheck is recorded in `.kota/runs/2026-06-28T20-30-18-343Z-builder-uy1cbi/source-file-size-recheck.json` with outcome `ok` and zero warnings.
- Observability recheck against commit `582864dba7ad` is recorded in `.kota/runs/2026-06-28T20-30-18-343Z-builder-uy1cbi/observability-obligation-recheck.json`; current staged observability recheck is recorded in `.kota/runs/2026-06-28T20-30-18-343Z-builder-uy1cbi/observability-obligation-current-recheck.json`; both have outcome `ok` with `missingFiles: []`.
- Focused tests passed: `pnpm exec vitest run src/core/agent-harness/readiness.test.ts src/modules/claude-agent-harness/executor.test.ts src/modules/daemon-ops/status-cli.test.ts src/modules/daemon-ops/status-cli-worktrees.test.ts src/modules/daemon-ops/status-cli-recovery-checkout.test.ts`.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run validate-tasks` passed.
