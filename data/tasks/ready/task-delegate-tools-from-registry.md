---
id: task-delegate-tools-from-registry
title: "Wire delegate sub-agent tool sets through the tool registry instead of static imports"
status: ready
priority: p2
area: architecture
summary: "delegate-prompts.ts hardcodes cross-module tool imports from execution, filesystem, git, and web-access modules, bypassing the tool registry. Sub-agents should receive tools from the registry so module-contributed tools are available and the module boundary is respected."
created_at: 2026-04-11T06:45:00Z
updated_at: 2026-04-11T06:45:00Z
---

## Problem

`src/delegate-prompts.ts` statically imports tool definitions and runners from
five different modules (execution, filesystem, git, web-access) plus
`core/tools/workspace`. This means:

- Sub-agents (explore, research, execute) get a hardcoded tool set that ignores
  module-contributed tools registered at runtime.
- The file creates a direct coupling from a root-level file into module
  internals, violating the module-first architecture.
- Adding a new tool to a module does not make it available to sub-agents without
  editing this file.

## Desired Outcome

The delegate system assembles sub-agent tool sets from the tool registry
(`core/tools/`) at runtime rather than static imports. Each delegation mode
(explore, research, execute) specifies which tool capabilities or groups it
needs; the registry resolves those to the currently registered tools and
runners.

The prompts (EXPLORE_PROMPT, RESEARCH_PROMPT, EXECUTE_PROMPT) and
`buildSubAgentPrompt` can stay in the same file or move to `core/tools/` — the
key change is replacing the static tool/runner catalogs with registry lookups.

## Constraints

- Do not change what tools sub-agents currently receive — this is a wiring
  refactor, not a capability change.
- The bounded shell timeout wrapper (`runShellBounded`) must be preserved.
- Keep the three delegation modes (explore, research, execute) with their
  current tool scopes.
- Do not introduce a new module just for this; use existing core/tools
  infrastructure.

## Done When

- `delegate-prompts.ts` no longer imports tool definitions or runners directly
  from module directories.
- Sub-agents receive the same tools as before, resolved through the registry.
- Build, typecheck, lint, and tests pass.
