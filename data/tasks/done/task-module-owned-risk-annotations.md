---
id: task-module-owned-risk-annotations
title: Let modules declare tool risk levels instead of hardcoding them in guardrails-classify.ts
status: done
priority: p2
area: architecture
summary: Module-contributed tools that aren't in the core registry are manually listed in guardrails-classify.ts safeTools() and moderateTools(). The mechanism to declare risk per module tool already exists (getExtensionToolRisk via extensionToolMeta) but built-in modules don't use it, keeping module risk policy centralized in core.
created_at: 2026-04-08T20:22:18Z
updated_at: 2026-04-08T21:00:00Z
---

## Problem

`src/guardrails-classify.ts` builds its `safeTools()` and `moderateTools()` sets from
two sources: core tool registry annotations (correct — module-agnostic) and a
manually maintained list of module-contributed tool names (e.g. `file_read`, `grep`,
`glob`, `github_get_pr`, `memory`, `schedule`). A comment in the file acknowledges this:
"Module-registered tools (not in coreRegistrations) are listed manually."

`getExtensionToolRisk()` already exists in `src/core/tools/index.ts` and reads risk from
`extensionToolMeta`. The mechanism is present; built-in modules simply don't use it
when registering their tools. Instead, their tools land in guardrails-classify.ts as
hardcoded strings — the same centralization problem being addressed for tool-groups.

When a new built-in module is added, its tools default to "dangerous" unless the
developer also remembers to update guardrails-classify.ts. This is an easy omission to
miss and a meaningful security-behavior gap.

## Desired Outcome

Built-in modules that contribute tools declare the guardrail risk level at registration
time (e.g. via the tool definition or the module registration call), using the same
`extensionToolMeta` path that `getExtensionToolRisk()` already reads.

`safeTools()` and `moderateTools()` remove the manual module-tool lists. Risk
classification for module tools falls through to `getExtensionToolRisk()` rather
than a hardcoded set.

A built-in module can declare its tool risk levels without editing a shared allowlist
in core, and a new module that omits risk annotation gets a clear "missing annotation"
warning at load time rather than silently defaulting to "dangerous".

## Constraints

- Preserve the existing guardrail behavior: the same tools must classify at the same
  risk level after the change.
- Do not change the `KotaModule` or `ToolDef` public interface in a way that breaks
  existing external modules; prefer additive annotation support.
- The "missing annotation" warning at load time is advisory (not a hard error) so
  existing third-party modules are not broken.
- Update `src/AGENTS.md` key module descriptions for guardrails-classify.ts if the
  interface changes materially.

## Done When

- The manual module-tool name lists in `safeTools()` and `moderateTools()` are removed.
- Built-in modules (filesystem, github, memory, scheduler, etc.) declare tool risk at
  registration so `getExtensionToolRisk()` returns the correct level.
- `classifyRisk()` returns the same results as before for all previously listed tools.
- A load-time warning fires when an module registers a tool with no risk annotation.
- Tests cover: module-declared safe tool classifies correctly; missing annotation
  produces warning; core tools are unaffected.
