---
id: task-protect-workflow-authority-provenance-from-agent-w
title: Protect workflow authority provenance from agent writes
status: done
priority: p1
area: security
task_class: Safety
summary: Move authoritative workflow claims and evidence outside every agent-writable root and expose one daemon-owned provenance seam.
created_at: 2026-08-24T02:13:37.492Z
updated_at: 2026-08-26T16:27:32.524Z
---

## Problem

Task claims, recovery lineage, calibration evidence, and other runtime records
live beside agent-authored artifacts under `.kota/runs/`. Some workflows also
grant broad write access to that tree, allowing file consistency to be mistaken
for runtime authenticity.

## Desired Outcome

Create one daemon-owned authority/provenance store outside every agent write
root. Agents write only their run-specific output directory; consumers resolve
claims, lineage, terminal state, and authenticated evidence through the shared
store rather than trusting sibling JSON files.

## Constraints

- The daemon/runtime owns authority writes and monotonic revisions. Agent
  prompts, workflow steps, and ordinary tools cannot mutate the store.
- Preserve inspectable run artifacts, but treat them as evidence inputs rather
  than authorization.
- Do not solve this only with mutually consistent files, hidden paths, or
  prompt instructions. The effective native sandbox must deny the writes.
- Reuse one provenance protocol for builder recovery and calibration adoption;
  do not create workflow-specific authority stores.
- Fail closed when provenance is missing, malformed, stale, or refers to a
  different scope, workflow, task, run, or source revision.

## Done When

- Security-review and other artifact-producing agents can write their exact
  output roots but cannot create or modify claims, sibling run metadata,
  calibration authority, or recovery lineage.
- The store binds scope, workflow, run, task/claim identity, source revision,
  status, revision, and authoring authority.
- Restart and recovery reconstruct the same authoritative projection without
  consulting agent-authored substitutes.
- Builder recovery and calibration consumers have a typed adoption seam and
  reject forged old-style bundles.

## Source / Intent

Owner-approved consolidation of confirmed findings
`security-builder-retry-lineage-forgeable` and
`security-calibration-run-bundle-remains-agent-forgeable`, verified again on
2026-08-24. This task owns the common boundary; the existing finding tasks own
consumer adoption and focused regression evidence.

## Initiative

Daemon-owned workflow authority and provenance.

## Acceptance Evidence

- Effective-sandbox fixture proving an artifact-writing native Codex run cannot
  modify authority records or sibling run state.
- Restart/recovery integration fixture showing authenticated provenance is
  preserved and forged run bundles are rejected.
- Source/permission report proving no agent definition retains broad
  `.kota/runs/` write access.

## Completion

The former claim/calibration premise was removed during the runtime migration.
`RunStateDatabase` is now the daemon-owned authority for admission, resources,
attempts, recovery, publications, and terminal state. Repository agents execute
inside runtime worktrees; artifact-producing agents receive only their exact
`agent-output` root, while sibling run files and the canonical SQLite state are
outside the native sandbox. Calibration adoption no longer exists.
