---
id: task-elevate-the-rendering-modules-primitives-to-addres
title: Elevate the rendering module's primitives to address the owner's still-poor CLI perception
status: ready
priority: p2
area: modules
summary: Strengthen the rendering module's primitive vocabulary to address the owner's 2026-04-25 'CLI still feels poor' reinforcement: add richer panels, dividers, structured columns, role-aware visual hierarchy beyond what Phase 2 migrated surfaces routed through.
created_at: 2026-05-06T05:12:41.960Z
updated_at: 2026-05-06T05:12:41.960Z
---

## Problem

`task-introduce-a-rich-cli-rendering-abstraction-for-all` shipped Phase 1
(rendering module + theme/transport) and Phase 2 (every KOTA terminal surface
routed through the module). Phase 3 is gated on operator-captured peer-CLI
side-by-side comparisons under `.kota/runs/peer-cli-comparison/` and cannot be
advanced autonomously. The parent task records the owner's 2026-04-25
reinforcement verbatim:

> "I want cli to be fully revamped! The dedicated module must be very advanced
> and use abstractions and concepts almost like proper UI. it sohuld use all
> the advanced UI construts using ascii and colors and formatting for nice
> and clean rendering... research which methods and approaches are there and
> poosibly libraries and packages which are clean and robust and reliable and
> are well maintained. If there are no such libraries implement it all
> yourself."

Reading: even after every surface routes through the module, the owner still
perceives the CLI as visually poor. The Phase 2 done items are
*plumbing-complete* — surfaces emit `LineNode`s, `kvBlock`s, and role-tagged
spans through `print(...)` — but the *primitive vocabulary itself* is still
narrow. `primitives.ts` exposes flat lines, headings, separators, kvBlocks,
status banners, lists, panels, tool calls, agent messages, diffs, and JSON.
What is missing is the structured vocabulary peer CLIs (gemini-cli, codex,
pi-mono, opencode) use to make terminal output feel product-grade: aligned
column layouts beyond two-column kvBlock, indent-aware nested groups,
role-foregrounded section headers with spacing rules, width-aware wrapped
prose, progress/spinner primitives that adapt across TTY/no-TTY, and
sectioned dashboards where status and activity are visually separated rather
than interleaved.

The parent task's `## Acceptance Evidence` already calls out one concrete
regression: "no repeated full blocks, no blank `Work` section, no merged
cost/defs cells, and clear separation between state and activity" — these are
*primitive-vocabulary* gaps, not migration gaps.

## Desired Outcome

The rendering module's `primitives.ts` carries a richer typed vocabulary that
covers the visual constructs peer CLIs use to feel product-grade: aligned
columns, nested groups with role-aware indent, width-aware wrapped prose,
spinner/progress primitives that degrade cleanly to no-TTY, and
section-bounded dashboards where state and activity render distinctly. Every
addition is exercised by a unit test that asserts the rendered output across
every theme. At least one operator-facing surface that the owner has flagged
as visually poor (the daemon dashboard `formatDaemonStatus` is the canonical
regression case named by the parent task) is rebuilt against the new
primitives so the lift is observable in `kota status` output rather than only
in the primitive set.

## Constraints

- One module owns rendering. Do not introduce a parallel rendering DSL,
  per-surface theme override, or hand-rolled ANSI escape outside the module.
- New primitives extend the discriminated union in `primitives.ts`. Surfaces
  that cannot be modeled with the current vocabulary add the missing
  primitive here — they do not reach around the module.
- Every primitive must degrade cleanly to the `no-color` theme and to the
  non-TTY pipe path. JSON / streaming-JSON surfaces stay on their own typed
  I/O path; the new primitives are human-facing only.
- Width adaptation is required, not optional. A primitive that hard-codes a
  fixed column count breaks operator terminals at smaller widths; column
  primitives must accept a target width and respond to the transport's
  detected width.
- Spinner / progress primitives must be testable without a real TTY. The pure
  `render(node, ctx)` path stays pure; animation lives in the transport, not
  in the render-tree primitives.
- This task does not duplicate the parent task's Phase 3 peer-CLI capture.
  The output here is a richer primitive set plus at least one operator-facing
  surface rebuild; the side-by-side comparison stays gated on operator
  hardware in the parent task.
- Do not extend `primitives.ts` past the file-size guideline by smuggling
  large helpers in. If a new primitive needs substantial layout helpers,
  factor them into a sibling helper file inside the module.

## Done When

- The rendering module ships at least the missing primitives that block the
  parent task's named regression case: aligned columns (beyond two-column
  kvBlock), nested groups with role-aware indent, width-aware wrapped prose,
  and a sectioned dashboard primitive that separates state and activity.
- A spinner / progress primitive lands with TTY animation in the transport
  and a pure render path that emits a static frame for non-TTY / piped
  output. Both paths have unit tests.
- `formatDaemonStatus` (the canonical regression named by the parent task) is
  rebuilt against the new primitives, with output asserted by a test that
  proves: no repeated full blocks, no blank `Work` section, no merged
  cost/defs cells, and clear separation between state and activity.
- Every new primitive is exercised by a unit test that renders it across all
  three themes (`default`, `ascii`, `no-color`) and asserts the output via
  `renderToString`, not by capturing process stdout.
- The module's `AGENTS.md` lists the new primitive categories at the
  conventions level (no per-primitive enumeration), and the parent task's
  `Status` section is updated to reference this task's commit so the
  initiative trail stays honest.

## Source / Intent

Direct owner reinforcement captured in the parent task body
(`task-introduce-a-rich-cli-rendering-abstraction-for-all`, lines 82–91)
on 2026-04-25: even after Phase 2 surface migrations landed, the owner
explicitly reads the CLI as still poor and asks for "very advanced
abstractions and concepts almost like proper UI". The parent task's Phase 3
peer-CLI capture is operator-only, but the owner's quality complaint is a
*primitive-vocabulary* signal, not a comparison-artifact signal. This task
extracts the autonomously-doable lift so the rendering initiative does not
sit idle waiting for operator hardware.

## Initiative

Product-grade terminal UX (parent task
`task-introduce-a-rich-cli-rendering-abstraction-for-all`): KOTA terminal
output should have one rendering system, one visual language, and the
primitive vocabulary needed to express the owner's "advanced UI constructs"
direction without surfaces reaching around the module.

## Acceptance Evidence

- Unit-test output (`renderToString`) committed alongside the new primitives
  exercising every theme and width contract.
- A CLI transcript captured to `.kota/runs/<run-id>/transcript.txt` showing
  `kota status` rendered through the rebuilt `formatDaemonStatus`, including
  output at a narrow terminal width to prove width-adaptation. Secrets must
  be redacted.
- A diff against `src/modules/rendering/primitives.ts` showing the new
  primitive variants typed into the discriminated union, plus the
  module-test file asserting them.
- The parent task's `Status` section updated to point at this task's commit
  so the initiative timeline remains traceable.
