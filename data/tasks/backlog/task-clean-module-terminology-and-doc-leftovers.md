---
id: task-clean-module-terminology-and-doc-leftovers
title: Clean stale module terminology and documentation leftovers
status: backlog
priority: p2
area: documentation
summary: Some code helpers, tests, and local docs still use old extension terminology or stale paths after the module-first cleanup.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T11:16:25Z
---

## Problem

The repo has mostly standardized on `module`, but some leftovers remain:
`EXTENSIONS_DIR` in module registry installers, `writeExtension` in module
discovery tests, stale references to `src/memory-cli.ts` in the knowledge module
instructions, and old client docs paths. These are small individually, but they
undermine the clarity of the module-first model.

There are also docs that still say "built-in module" in places where the current
concept is simply project-owned or installed modules.

## Desired Outcome

Terminology and local documentation use one current vocabulary: module, project
module, installed module, tool, workflow, channel, skill, agent. Stale paths and
old migration-era wording are removed or corrected close to their scope.

## Constraints

- Do not turn this into a broad docs rewrite.
- Do not add inventories of files or functions.
- Do not edit terminal task history unless it is necessary for live agents; old
  done-task wording can remain historical unless it is actively misleading.
- Keep changes scoped to current docs, local `AGENTS.md`, tests, and live code helpers.

## Done When

- Current source and active docs no longer use old extension terminology for modules except where describing external historical artifacts.
- Local `AGENTS.md` files for knowledge, memory, clients, and module registry areas are accurate.
- Any remaining occurrence of extension/legacy/migration wording is reviewed and either justified or removed.
- No tracked npm artifact remains where pnpm is the intended package manager.
