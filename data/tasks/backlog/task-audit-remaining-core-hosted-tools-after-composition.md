---
id: task-audit-remaining-core-hosted-tools-after-composition
title: Audit remaining core-hosted tools after composition extraction
status: backlog
priority: p2
area: architecture
summary: After batch, pipe, and map move out of core, the remaining core tool registry should be reassessed so core keeps only true runtime primitives.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T11:16:25Z
---

## Problem

The open composition task covers `batch`, `pipe`, and `map`, but
`src/core/tools/index.ts` still owns other tools that may or may not be true
core primitives: `workspace`, `prompt_template`, `module_factory`, `todo`,
`custom_tool`, and approval/session coordination tools. Some are likely core
runtime affordances; others may belong in modules.

The goal is not to move everything blindly. The goal is to make the core tool
registry small and defensible.

## Desired Outcome

After the composition tools are extracted, the remaining core-hosted tools are
audited against the core boundary. Any non-core cluster is moved into a module,
and tools that stay in core have a concise rationale in the local tool
instructions or code structure.

## Constraints

- Depends on `task-extract-composition-tools-from-core-into-an-option`.
- Do not create duplicate tool names or compatibility aliases.
- Do not move session/runtime primitives into modules just to reduce file count.
- Prefer cohesive capability moves over isolated file shuffling.

## Done When

- The core tool registry is materially smaller or explicitly justified tool by tool at the boundary level.
- Any moved tool is contributed by a module using the standard `ToolDef` protocol.
- No behavior-changing shortcut is taken to make the move easier.
- Local `src/core/tools/AGENTS.md` accurately describes what remains.
