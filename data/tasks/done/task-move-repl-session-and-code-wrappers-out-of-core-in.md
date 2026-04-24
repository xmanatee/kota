---
id: task-move-repl-session-and-code-wrappers-out-of-core-in
title: Move REPL-session and code-wrappers out of core into the execution module
status: done
priority: p1
area: architecture
summary: Relocate code-wrappers.ts and repl-session.ts from src/core/tools/ into src/modules/execution/ so core no longer owns Python/Node REPL runtime infrastructure that only the execution module and custom-tool surface need.
created_at: 2026-04-24T07:31:56.370Z
updated_at: 2026-04-24T07:39:12.404Z
---

## Problem

`src/core/tools/repl-session.ts` and `src/core/tools/code-wrappers.ts` host
Python and Node.js REPL lifecycle, sentinel protocol, and wrapper scripts used
for running code-as-tools. They exist in core only because three surfaces need
them: the `custom-tool.*` cluster (also in core/tools), the `execution`
module's `code_exec` tool (`src/modules/execution/code-exec.ts`), and the
manifest-to-module runtime (`src/core/manifest/execution.ts` +
`src/core/manifest/types.ts`).

Core's stated boundary (`src/core/AGENTS.md`, `src/core/tools/AGENTS.md`)
says core owns runtime substrate primitives — the agent/session loop,
workflow runtime, daemon runtime, guardrails, tool runner — not
general-purpose capabilities. Python/Node REPL infrastructure is a concrete
capability pack, not a runtime primitive, and it is exactly the kind of thing
the "module-owned capability packs" direction in `src/AGENTS.md` calls out
("shell/process access, filesystem actions" etc. "should prefer module-owned
capability packs"). It currently lives in core only because `custom-tool` and
manifest-code execution sit in core too.

This is a visible core-shrink seam and a prerequisite to moving `custom-tool`
itself out of core in a follow-up (see Plan).

## Desired Outcome

`src/modules/execution/` owns the Python/Node REPL lifecycle and wrapper
protocol as a normal module capability. Core files that still legitimately
need it (manifest-code execution, the core-hosted `custom-tool` during the
transition) reach the capability through a typed cross-tree import
(`#modules/execution/...`), not through `#core/tools/...`. Core's `tools/`
directory no longer hosts Python/Node REPL infrastructure; `core/tools/AGENTS.md`
no longer lists `repl-session` or `code-wrappers` as core-hosted runtime
infrastructure.

## Constraints

- Move the files bodily — do not leave a re-export shim in `src/core/tools/`.
  One source of truth per capability; no parallel alias paths.
- Preserve the existing sentinel / wrapper / timeout protocol exactly.
  `code_exec`, `custom_tool`, and manifest-code-tools share the same REPL
  sessions today (`sessions[lang]`) because they share process state; that
  shared-singleton semantics must survive the move.
- No module-loading cycles: the `execution` module already exists and is
  loaded normally; after the move, `custom-tool` (still in core/tools) pulls
  from `#modules/execution/...` as a typed import. Manifest execution does
  the same. No new `KotaModule.dependencies` declaration is required for
  core-side pulls because core is not a module.
- Keep the `#modules/execution` surface small and deliberate: export only
  what the external callers actually consume (`REPLSession`, `sessions`,
  `cleanupSessions`, `findPythonBinary`, `Language`, `DEFAULT_TIMEOUT`,
  `MAX_OUTPUT`, and the wrapper/sentinel constants used by tests). Do not
  broaden the surface opportunistically.
- Co-locate the tests for the moved files alongside the new home, and keep
  their existing coverage intact.
- Do not expand scope to `custom-tool` or manifest-code relocation in this
  task. The follow-up plan sketched below is not part of Done-When.

## Done When

- `src/core/tools/repl-session.ts`, `src/core/tools/repl-session.test.ts`,
  `src/core/tools/code-wrappers.ts`, and `src/core/tools/code-wrappers.test.ts`
  no longer exist under `src/core/`.
- Equivalent files live under `src/modules/execution/` with their exports
  reachable via `#modules/execution/...` imports.
- `src/core/tools/custom-tool.ts`, `src/core/tools/custom-tool-handlers.ts`,
  `src/core/tools/custom-tool-persistence.ts`, `src/core/manifest/execution.ts`,
  `src/core/manifest/types.ts`, and any other pre-existing importers reach
  the moved files through their new module path — not through a re-export
  shim in `src/core/tools/`.
- `src/core/tools/AGENTS.md` is updated to remove `repl-session` and
  `code-wrappers` from its "Runtime infrastructure" list. `src/modules/execution/AGENTS.md`
  notes that the module owns the Python/Node REPL lifecycle used by
  `code_exec`, `custom_tool`, and manifest-code tools.
- The full test suite, type-check, and lint pass. Tests for REPL lifecycle,
  `code_exec`, `custom_tool`, manifest-code execution, and the autonomy
  integration suites that exercise `code_exec` all still pass.

## Plan

Scope-boundary note: this task is explicitly Phase 1 of a longer core-shrink.
Subsequent phases (new tasks seeded only after this lands) will move
`custom-tool.*` out of core/tools into a module, and move manifest-code
tool-runner construction out of `core/manifest/execution.ts` into the
execution module. Do not conflate those phases with this one — a larger edit
risks an unreviewable diff and overlapping churn with the just-landed Stage 6
Anthropic type-audit migration.

Phase 1 (this task):

- Copy the four files into `src/modules/execution/`, update their
  sibling imports to local relative paths.
- Update every importer under `src/core/` and under `src/modules/` to use
  `#modules/execution/<file>.js`. Keep type-only imports narrow.
- Verify `src/modules/execution/code-exec.ts` imports the new local path
  (shortest route) rather than the cross-module alias.
- Update `src/core/tools/AGENTS.md` and `src/modules/execution/AGENTS.md`
  to match.
- Run the full suite (typecheck + tests + biome) and fix any regressions
  before finishing.
