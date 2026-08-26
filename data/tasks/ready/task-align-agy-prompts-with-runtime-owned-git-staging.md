---
id: task-align-agy-prompts-with-runtime-owned-git-staging
title: Align AGY prompts with runtime-owned Git staging
status: ready
priority: p1
area: autonomy
task_class: Platform
summary: Remove the native AGY instruction to stage changes and enforce one Git ownership contract in which agents edit files while workflow runtime alone stages and commits.
created_at: 2026-08-13T10:15:23.625Z
updated_at: 2026-08-26T23:41:11.215Z
---

## Problem

KOTA's repository contract says native CLI agents may edit workspace files but
must treat Git metadata as read-only; workflow runtime owns staging and commits.
The AGY initial prompt contradicts that contract with `Do not run git commit;
stage changes`. Repair prompts already say not to run `git add` or `git commit`.
The two instruction paths therefore give the same AGY session different rules,
encourage denied Git operations, and make failures harder to attribute to the
agent, sandbox, or workflow host.

## Desired Outcome

Every native harness receives one unambiguous Git ownership contract: inspect
read-only Git state when useful, edit only task-scoped workspace files, write
the requested evidence/commit-message artifacts, and leave index staging and
commit creation to the workflow runtime.

## Constraints

- Fix the shared native-agent instruction source or AGY adapter boundary that
  owns this behavior; do not add another repair-only override.
- Preserve workflow-owned exact-path staging and existing read-only Git access.
- Do not grant agents writable Git metadata or weaken the machine-authority
  sandbox to make the contradictory instruction executable.

## Done When

- The initial and repair AGY prompts state the same runtime-owned staging rule.
- No production native-agent prompt asks an agent to stage or commit changes.
- A behavioral harness fixture records an AGY initial turn and repair turn,
  proves both can edit task files without attempting Git metadata writes, and
  shows the workflow host stages the resulting paths.
- Source search finds one canonical Git ownership instruction mechanism rather
  than adapter-specific variants with different semantics.

## Source / Intent

Created from the owner-requested review of the last 50 commits and AGY rollout
on 2026-08-13. Evidence is the instruction at
`src/modules/antigravity-cli-agent-harness/adapter.ts:234`, the contradictory
repair-loop instruction, and the root `AGENTS.md` runtime-staging contract.

## Initiative

One native-agent execution contract across providers.

## Acceptance Evidence

- Focused initial/repair prompt transcript and host-staging fixture output.
- Source-search artifact showing no production native prompt instructs `git
  add`, staging, or committing.
