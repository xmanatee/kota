---
id: task-shrink-core-tool-registry-into-extensions
title: Shrink the core tool registry so generic capabilities load from built-in extensions
status: done
priority: p1
area: architecture
summary: src/tools/index.ts still acts as a large hardcoded registry for many tool implementations. KOTA should keep only minimal host/runtime tools in core and move generic capability tools behind built-in extensions or explicitly classify why they belong in core.
created_at: 2026-04-08T14:45:00Z
updated_at: 2026-04-08T14:45:00Z
---

## Problem

KOTA's recent capability-pack migration moved filesystem, execution, git, notebook, and read-document behind built-in extensions, but `src/tools/index.ts` is still a large hardcoded registry that pulls together many tool implementations from `src/tools/`. That makes the repo still read as a big core bucket even after the extension protocol exists.

Right now there is no single open task that closes this remaining architecture gap. Without one, builder can keep doing adjacent runtime features while the most visible structural issue stays in place.

## Desired Outcome

The remaining tool surface is split more honestly between:

1. minimal host/runtime tools that truly belong in core because they are part of the agent protocol, workflow control, approvals, or extension loading itself
2. generic capability tools that should load from built-in extensions instead of the hardcoded core registry

The task should leave `src/tools/index.ts` smaller and conceptually clearer, even if the migration lands in a few cohesive batches rather than one giant diff.

## Constraints

- Do not move protocol/runtime control primitives out of core just to satisfy a directory rule. Core can keep the small set of tools that are truly part of host/runtime control.
- Prefer cohesive batches over one giant migration. If only part of the remaining registry can move cleanly, land one honest slice and capture any follow-up explicitly.
- Do not add compatibility shims or dual registration paths. Remove obsolete registry wiring directly.
- Update `docs/ARCHITECTURE.md`, `src/tools/AGENTS.md`, and `src/extensions/AGENTS.md` to match the resulting ownership model.

## Done When

- There is a clear documented boundary between core runtime tools and extension-owned capability tools.
- At least one meaningful remaining capability cluster is removed from the hardcoded `src/tools/index.ts` registry into a built-in extension, or the task conclusively shrinks the registry to a smaller explicitly-justified core set.
- The resulting ownership is reflected in docs and AGENTS inventories, and validation/tests remain green.
