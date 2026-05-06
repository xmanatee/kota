---
id: task-re-route-phase-2-terminal-surfaces-onto-the-elevat
title: Re-route Phase 2 terminal surfaces onto the elevated rendering primitive vocabulary
status: done
priority: p2
area: modules
summary: Migrate hand-rolled LineNode-padding tables and section soup across Phase 2 terminal surfaces (repo-tasks list, workflow-ops run-show chain tree, run-list/run-stats/run-cost, history list/show, memory/knowledge/skill-ops listings) onto the elevated columns/group/dashboard/sectionRule/prose primitives so width-adaptation and role-aware visual hierarchy land outside formatDaemonStatus.
created_at: 2026-05-06T05:46:53.412Z
updated_at: 2026-05-06T06:17:42.393Z
---

## Problem

`task-elevate-the-rendering-modules-primitives-to-addres` lifted the
rendering module's primitive vocabulary — `columns`, `group`, `dashboard`,
`sectionRule`, `prose`, `spinner`, `progress` — and rebuilt
`formatDaemonStatus` against the new primitives as the canonical
regression. But the Phase 2 surface migrations the parent task
(`task-introduce-a-rich-cli-rendering-abstraction-for-all`) recorded as
`done` predated the new vocabulary: each migrated surface still emits
hand-rolled `LineNode` tables built from `padEnd(...)` math and
`"-".repeat(...)` separator rules. The newly added primitives are
referenced in only three places outside the rendering module itself:
`daemon-ops/index.ts` (the regression case), `daemon-ops/dashboard.ts`,
and `autonomy/workflows/daily-digest/render.ts`.

Concretely, today's tables hard-code their column widths and rule
length:

- `repo-tasks/cli.ts buildTaskListLines` — manual `idWidth`/`prioWidth`/
  `stateWidth` math, header row built with `padEnd`, separator built
  from `"-".repeat(idWidth + prioWidth + stateWidth + 12)`. The Title
  column has no `maxWidth`; long titles overflow at narrow widths.
- `workflow-ops/runs/run-show.ts buildChainLines` — recursive tree
  printer that concatenates ASCII connectors (`├─`/`└─`) and status
  glyphs into raw spans. No role-aware indent; nested groups can't
  benefit from `group`'s width-aware indent rule.
- `workflow-ops/runs/{run-list,run-stats,run-cost,run-diff}.ts`,
  `history/cli.ts` history list, history show, the memory/knowledge/
  skill-ops/agent-ops/module-manager listings — same hand-rolled
  pattern. Each surface re-derives column widths and separator rules
  inline.

The result is exactly what the owner's 2026-04-25 reinforcement
(verbatim in the parent task body) called out: the primitives are
there, but the surfaces are still flat. Width adaptation and role-aware
visual hierarchy don't reach the operator until each call site is
re-routed onto the typed `columns` / `group` / `sectionRule` /
`dashboard` / `prose` primitives.

## Desired Outcome

Every still-hand-rolled table and section block across the Phase 2
migrated surfaces emits typed `ColumnsNode` / `GroupNode` /
`SectionRuleNode` / `DashboardNode` / `ProseNode` instead of
`LineNode[]` with `padEnd` math. Column widths flow from
`ColumnSpec.minWidth` / `maxWidth` / `align`; role-aware spans flow
from `ColumnRow.role` / `ColumnSpec.role`; separator rules flow from
`sectionRule(label)`. Wrapped prose flows through the `prose`
primitive's word-wrap path. The transport's detected width and theme
adapts every surface centrally rather than each builder hard-coding
its own width math.

`buildTaskListLines`, `buildChainLines`, and the equivalent helpers in
`workflow-ops/runs/*` and the module CLIs (`history`, `memory`,
`knowledge`, `skill-ops`, `agent-ops`, `module-manager`) return typed
nodes that are assertable via `renderToString` across all three themes
(`default`, `ascii`, `no-color`) and at least two widths. Surfaces
that today print interleaved heading + line + line + line soup gain a
`dashboard` / `group` wrapper so state and activity are visually
distinct, mirroring the regression-case improvement
`formatDaemonStatus` already delivers.

## Constraints

- One module owns rendering. Do not introduce a second column
  abstraction, a per-surface theme override, or a hand-rolled ANSI
  escape outside the module.
- Migrated surfaces export pure `RenderNode`-returning helpers (e.g.
  `buildTaskListNode(...)`, `buildChainNode(...)`). Do not keep both
  the old `LineNode[]` helper and a new `RenderNode` helper — the old
  surface migrates onto the new primitive and the previous shape is
  deleted in the same change. Tests update to assert via
  `renderToString` rather than line-array shape.
- JSON / streaming-JSON / bare-id machine-parseable paths stay on
  their existing typed I/O. The migration is for human-facing
  rendered output only.
- Width adaptation is required, not optional. Every column with text
  that can run long (`Title`, `summary`, `path`) declares a
  `maxWidth` so it wraps cleanly under the transport's detected
  width, instead of overflowing into the next column.
- Role-aware coloring continues to come from semantic role tags
  (`error`, `warn`, `info`, `muted`, `success`, `accent`). Do not
  hard-code SGR codes outside the rendering module.
- Tests assert via `renderToString` on the typed node, not by
  capturing `process.stdout.write`. The lone exception is the
  existing `cli-transport.test.ts` style transport-level assertion.
- Do not extend the migration into surfaces this task does not name.
  If a separate surface (e.g. an autonomy run summary) needs the same
  lift, file a follow-up task — keep this lift focused.

## Done When

- `repo-tasks/cli.ts buildTaskListLines` is replaced by a
  `buildTaskListNode` that returns a `ColumnsNode` with
  `ColumnSpec[]` for ID / Pri / State / Title (Title has a
  `maxWidth`), and a unit test asserts the rendered output across the
  three themes at a wide and a narrow width.
- `workflow-ops/runs/run-show.ts buildChainLines` is replaced by a
  `buildChainNode` that emits `group(...)` per nested chain level
  (role-aware indent) plus `LineNode` leaves for each step row. The
  ASCII connectors stay in the leaves; the indent comes from the
  group primitive. A unit test asserts the rendered tree against
  `renderToString`.
- The remaining `workflow-ops/runs/{run-list,run-stats,run-cost,
  run-diff}.ts` builders and the module CLIs (`history`, `memory`,
  `knowledge`, `skill-ops`, `agent-ops`, `module-manager`) emit
  `ColumnsNode` / `GroupNode` / `SectionRuleNode` / `ProseNode` for
  their previously hand-rolled tables and section blocks. Each
  surface gains a unit test asserting via `renderToString` at
  representative widths.
- A scenarios pack diff under `.kota/runs/<run-id>/` shows the
  before/after rendered output for `kota task list`, `kota run
  show`, `kota run list`, and `kota history list` at a wide (120 col)
  and a narrow (60 col) terminal width, secrets redacted, so the
  width-adaptation lift is observable rather than only theoretical.
- The rendering module's `AGENTS.md` migration-pattern section is
  updated to reflect the typed-node-helper convention without
  enumerating per-surface helpers.
- The parent task `task-introduce-a-rich-cli-rendering-abstraction-
  for-all`'s `## Status` section is appended with a 2026-05-06 entry
  pointing at this task's commit so the initiative timeline stays
  honest. The parent task remains `blocked` on Phase 3 peer-CLI
  capture; this task does not duplicate that gate.

## Source / Intent

Direct owner reinforcement captured verbatim in the parent task body
(`task-introduce-a-rich-cli-rendering-abstraction-for-all`,
2026-04-25): "I want cli to be fully revamped! ... very advanced
abstractions and concepts almost like proper UI ... advanced UI
construts using ascii and colors and formatting for nice and clean
rendering". `task-elevate-the-rendering-modules-primitives-to-addres`
addressed the *primitive vocabulary* half of that signal. This task
addresses the *surface migration* half: the new vocabulary only
reaches the operator if the still-hand-rolled tables route through it.

The runtime evidence that motivates this task is direct: the
elevated primitives (`columns`, `group`, `dashboard`, `sectionRule`,
`prose`, `spinner`, `progress`) are referenced in only three files
outside the rendering module itself — `daemon-ops/index.ts`,
`daemon-ops/dashboard.ts`, and `autonomy/workflows/daily-digest/
render.ts`. Every other Phase 2 surface still hand-rolls padding
math.

## Initiative

Product-grade terminal UX (parent task
`task-introduce-a-rich-cli-rendering-abstraction-for-all`): KOTA
terminal output should have one rendering system, one visual
language, and the elevated primitive vocabulary should reach every
operator-facing surface — not only the canonical regression case.

## Acceptance Evidence

- A diff against the named surfaces showing typed node helpers
  replacing `LineNode[]` builders, with `padEnd`/`"-".repeat(...)`
  removed from each migrated surface.
- Unit tests exercising `renderToString` across all three themes
  (`default`, `ascii`, `no-color`) at wide and narrow widths for at
  least `buildTaskListNode`, `buildChainNode`, and the `run-list` /
  `run-stats` / `history list` builders.
- Rendered scenario transcripts under `.kota/runs/<run-id>/`
  capturing `kota task list`, `kota run show <id>`, `kota run list`,
  and `kota history list` at 120-col and 60-col widths to prove the
  width-adaptation lift is observable, secrets redacted.
- Parent task `## Status` section updated with a 2026-05-06 entry
  pointing at this task's commit so the initiative timeline stays
  traceable.
