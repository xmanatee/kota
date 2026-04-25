---
id: task-introduce-a-rich-cli-rendering-abstraction-for-all
title: Introduce a rich CLI rendering abstraction for all terminal output
status: blocked
priority: p2
area: modules
summary: Replace ad-hoc console printing with a dedicated rendering layer (library or module) used by daemon mode, CLI mode, and every surface, inspired by gemini-cli / codex / pi / opencode.
created_at: 2026-04-22T16:46:53.748Z
updated_at: 2026-04-25T12:07:36.046Z
---

## Problem

KOTA's terminal output today is built from ad-hoc `console.log` and bespoke
formatting across `src/cli.ts`, the daemon-ops output paths, interactive
sessions, and many module-owned commands. The result feels visually simplistic
next to gemini-cli, codex, pi, and opencode, which all render structured
blocks, dividers, role-aware colors, and theme- and width-aware layout. There
is no shared abstraction for "this is a tool call", "this is an agent message",
"this is a status banner", so every surface redevelops its own look, with
inconsistent formatting and no path to width adaptation or theming.

## Desired Outcome

One rendering layer owns all terminal output for KOTA — daemon-mode readouts,
CLI mode, interactive sessions, module commands, workflow runs. It exposes a
typed vocabulary of UI primitives (panels, separators, key/value blocks,
status banners, tool-call blocks, agent-message blocks, diff blocks, spinners)
that adapts to terminal theme and width. Every call site that prints to the
terminal routes through this layer; nothing prints raw ANSI outside of it.
Output quality is comparable to the peer CLIs referenced above and is easy to
extend as new surfaces land.

## Constraints

- Pick one mechanism. Either adopt an existing library (e.g. an Ink-style or
  pi-mono-style terminal UI toolkit) or build one shared module — not both.
  Research peer tools first and record the decision.
- The rendering layer lives as a module under `src/modules/` unless it is
  unavoidably a core primitive. Core stays small; rendering should not live in
  `src/core/` by default.
- Theme and width adaptation is required, but must degrade cleanly in
  non-interactive or dumb terminals so scripts and CI output stay machine-
  parseable. Do not break existing JSON / streaming-JSON surfaces.
- No parallel rendering paths. Existing surfaces migrate onto the new layer;
  ad-hoc `console.log` becomes a lint violation inside migrated areas.
- Do not add a second public prompt/UI DSL; the vocabulary is typed code.
- Keep it testable by separating the render tree from the terminal transport
  so unit tests can assert the tree without an actual TTY.

## Done When

- A typed rendering module exists with a documented primitive vocabulary, a
  terminal transport that handles theme/width/no-TTY, and a pure
  render-tree-to-string path for tests.
- Every KOTA terminal surface (CLI mode, daemon-ops commands, interactive
  session output, workflow-ops readouts, module CLIs) routes through the
  module; ad-hoc `console.log` for user-facing output is removed or lint-
  blocked in migrated areas.
- Side-by-side output matches or beats gemini-cli / codex / pi / opencode on
  representative scenarios (status banner, session turn, tool invocation, run
  summary), recorded as evidence under `.kota/runs/` or a dedicated artifact.
- Documentation at the module's `AGENTS.md` describes the primitive
  vocabulary, theming model, and TTY-vs-non-TTY behavior at the conventions
  level without enumerating every primitive.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/peer-cli-comparison
description: peer-CLI side-by-side captures (gemini-cli, codex, pi, opencode) for terminal rendering scenarios
```

## Source / Intent

Owner captures repeatedly called out daemon and CLI output as broken, ugly, and
not comparable to professional coding CLIs. The intent is not merely to add a
rendering helper; it is to make every human-facing terminal surface feel
coherent, inspectable, and product-grade.

2026-04-25 inbox reinforcement (verbatim): "I want cli to be fully revamped!
The dedicated module must be very advanced and use abstractions and concepts
almost like proper UI. it sohuld use all the advanced UI construts using ascii
and colors and formatting for nice and clean rendering... research which
methods and approaches are there and poosibly libraries and packages which are
clean and robust and reliable and are well maintained. If there are no such
libraries implement it all yourself." Reading: even after Phase 2 migrations
landed, the owner still perceives the CLI as poor. The peer-CLI capture in the
unblock precondition and the "library or self-built" decision recorded in the
Constraints remain the bar; this reinforces that bar is not yet cleared.

## Initiative

Product-grade terminal UX: KOTA terminal output should have one rendering
system, one visual language, and transcript-level regression evidence across
daemon, session, workflow, and module command surfaces.

## Acceptance Evidence

- Rendering scenario transcripts under `.kota/runs/` or an equivalent checked
  fixture show daemon status, session turn, tool invocation, and run summary at
  representative terminal widths.
- The daemon output pasted by the owner is represented as a regression case:
  no repeated full blocks, no blank `Work` section, no merged cost/defs cells,
  and clear separation between state and activity.
- Migrated directories have a mechanical guard against ad-hoc user-facing
  console output, while structured JSON paths remain explicit exceptions.

## Plan

Phase 1 — land the module (this run):

- Ship `src/modules/rendering/` with the typed primitive vocabulary, a
  pure `render(node, ctx)` path, a `TerminalTransport` that handles
  theme and width detection plus `NO_COLOR` / `KOTA_RENDERER_THEME`
  overrides, and unit tests that assert output against all three
  themes.
- Record the "one KOTA-owned module, no Ink-style framework" research
  decision in the run directory's `peer-cli-comparison.md`.
- Migrate the two daemon-ops status surfaces (`status-cli` and
  `formatDaemonStatus`) onto the module as the first consumers.
- Write the module's `AGENTS.md` at the conventions level.
- Emit a scenarios pack (`rendering-scenarios.md`) that renders status
  banner, session turn, tool invocation, and run summary across all
  three themes.

Phase 2 — migrate remaining surfaces (follow-up runs):

- [done] Replace `dashboard.ts`'s `styleText` calls and hand-rolled
  stat grid with rendering primitives. `formatStatsGrid` now emits
  typed `LineNode[]` carrying role-aware value spans.
- [done] Migrate `workflow-ops/runs/run-show` onto the module
  (including the chain-tree printer, now exposed as
  `buildChainLines`).
- [done] Migrate remaining workflow-ops readouts: `run-list`, `run-cost`,
  `run-stats`, `run-diff`, `follow`, `logs`, `step-inspect`, and the
  shared `workflow-logs` streaming paths. Pure helpers now return
  `LineNode[]` / `RenderNode` so tests assert via
  `renderToString`. Machine-parseable `--json` paths intentionally keep
  their direct `console.log(JSON.stringify(...))` output per the module
  contract on structured surfaces.
- [done] Migrate `repo-tasks` CLI (`task list`, `task move`, `task gc`,
  `task create`, `task capture`) onto the module. `buildTaskListLines`
  exposes the table as `LineNode[]` with role-aware priority/state
  spans; confirmation output flows through `print(...)` so theme/width
  adaptation applies. `repo-tasks` now declares `rendering` as a
  dependency.
- [done] Migrate `history` CLI (`history list`, `history show`,
  `history delete`, `history clear`) onto the module. `history list`
  uses a `LineNode` table; `history show` uses `kvBlock` for the
  record summary and `AgentMessage`-adjacent styled lines for each
  message; `history` now declares `rendering` as a dependency.
- [done] Migrate remaining module CLIs (memory, knowledge, webhook,
  owner-questions, guardrails-audit, approval-queue, eval-harness,
  skill-ops, agent-ops, module-manager) onto the module. All listed
  modules now declare `rendering` as a dependency, emit human-facing
  output through `print(...)` primitives (`LineNode` tables, `kvBlock`
  detail views, role-tagged spans), and keep `--json` / bare-id paths
  on `console.log` per the module contract. Test fixtures that asserted
  `console.log` captures now intercept `process.stdout.write` so
  rendered output is observable.
- [done] Migrate interactive session streaming and `cli.ts` pipe-mode
  output. `CliTransport` in `core/loop/transport.ts` now routes every
  non-streaming event through two `TerminalTransport` instances (one
  for stdout, one for stderr); streaming text/thinking/progress
  continue to pass through as raw chunks via `writeRaw` so partial
  chunks are not newline-wrapped. `history/cli.ts`'s REPL and
  `history/cli-commands.ts`'s error paths, and `cli.ts`'s fatal and
  prompt-validation paths, all emit typed `LineNode`s through a
  stderr transport.
- [done] Add a lint rule that blocks ad-hoc `console.log` inside every
  migrated directory so the prohibition is mechanically enforced. A
  `biome.json` override pins `suspicious/noConsole` to `error` for the
  migrated paths with `allow: ["warn", "error"]`; structured JSON and
  bare-id output paths carry per-line `biome-ignore` comments
  explaining why they stay on `console.log`.

Phase 3 — peer-CLI capture (operator-facilitated, blocks the task):

- Run the scenarios pack through gemini-cli, codex, pi, and opencode on
  an operator workstation and pair the outputs in
  `.kota/runs/<run-id>/peer-cli/`. The scenarios script lives at
  `scripts/render-scenarios.mjs` so both sides share one input set.
- Until those peer-CLI screenshots/transcripts land, the task's
  Done-When bullet 3 cannot be honestly verified autonomously, so the
  task stays in `blocked`. Unblock by either capturing the comparison
  on operator hardware or by narrowing Done-When to drop the
  comparison requirement.
