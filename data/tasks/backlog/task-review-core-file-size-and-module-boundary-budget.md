---
id: task-review-core-file-size-and-module-boundary-budget
title: Review core file size and module boundary budget
status: backlog
priority: p2
area: architecture
summary: Run a focused boundary/file-size pass over the largest core files (kota-client, daemon-client, daemon, daemon-control, run-executor) and either open specific split tasks that move ownership toward modules or prove the file should stay as-is.
created_at: 2026-04-28T22:04:43.355Z
updated_at: 2026-04-28T22:04:43.355Z
---

## Problem

The 2026-04-28 broad daemon review found core is well guarded but still has
large files and module-owned protocol details in central places. Known
examples:

- `src/core/server/kota-client.ts`
- `src/core/server/daemon-client.ts`
- `src/core/daemon/daemon.ts`
- `src/core/daemon/daemon-control.ts`
- `src/core/workflow/run-executor.ts`

Some of this is already partially addressed by
`task-distribute-kotaclient-namespace-types-and-daemon-s` (currently blocked
on an owner-decision about chunking). The remaining files have not been
reviewed against the architecture's "core stays small" rule.

## Desired Outcome

A focused boundary/file-size pass that, for each of the listed files (and
any neighbors found during the review), produces one of two outcomes:

- A specific, normalized split task that moves ownership toward modules, or
- An explicit decision to keep the file as-is, recorded with the reasoning
  so future reviews do not re-litigate it.

Outputs should sharpen the existing module-first/core-shrinking direction,
not generate generic mechanical splits.

## Constraints

- Do not produce mechanical split tasks unless the split moves ownership
  toward the architecture docs (module-first/core-shrinking).
- Coordinate with the existing
  `task-distribute-kotaclient-namespace-types-and-daemon-s`; do not
  duplicate it.
- "Keep as-is" decisions must record the reasoning (single cohesive
  protocol surface, framework constraints, etc.) so the next reviewer can
  trust the verdict.
- Do not let this devolve into generic file-size cleanup; the bar is
  ownership, not line count.

## Done When

- Each listed file (and any neighbors surfaced during the pass) has either a
  specific normalized split task or a documented "keep as-is" verdict with
  reasoning.
- Any new split tasks declare a real `## Initiative` aligned with
  module-first/core-shrinking, not boilerplate file-size cleanup.
- The review output lives as a single inspectable artifact, not multiple
  scattered notes.

## Source / Intent

2026-04-28 broad daemon review (verbatim): "core is well guarded but still
has large files and module-owned protocol details in central places. Known
examples: src/core/server/kota-client.ts, src/core/server/daemon-client.ts,
src/core/daemon/daemon.ts, src/core/daemon/daemon-control.ts,
src/core/workflow/run-executor.ts. Desired outcome: Produce a focused
boundary/file-size pass that either opens specific split tasks or proves
the file should stay as-is. Do not create mechanical split work unless it
moves ownership toward the architecture docs."

## Initiative

Module-first / core-shrinking: keep the runtime kernel small and protocol-
oriented as the system grows by holding visible architecture debt
accountable to a real review rather than letting central files keep
accreting module-owned surface area.

## Acceptance Evidence

- A run-directory artifact under `.kota/runs/` listing every reviewed file,
  the verdict (split task id or "keep as-is" with reasoning), and any new
  split tasks that were opened.
- The new split tasks (if any) appear in `data/tasks/backlog/` with proper
  `## Initiative` sections referencing the boundary review.
