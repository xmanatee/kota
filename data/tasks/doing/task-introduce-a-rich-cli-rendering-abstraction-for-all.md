---
id: task-introduce-a-rich-cli-rendering-abstraction-for-all
title: Introduce a rich CLI rendering abstraction for all terminal output
status: doing
priority: p2
area: modules
summary: Replace ad-hoc console printing with a dedicated rendering layer (library or module) used by daemon mode, CLI mode, and every surface, inspired by gemini-cli / codex / pi / opencode.
created_at: 2026-04-22T16:46:53.748Z
updated_at: 2026-04-22T18:23:24.268Z
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

- Replace `dashboard.ts`'s `styleText` calls and hand-rolled stat grid
  with rendering primitives.
- Migrate workflow-ops readouts (`run-show`, `run-list`, `run-cost`,
  `run-stats`, `run-diff`, `follow`, `logs`) onto the module.
- Migrate module CLIs (repo-tasks, history, memory, knowledge, webhook,
  owner-questions, guardrails-audit, approval-queue, eval-harness,
  skill-ops, agent-ops, module-manager) onto the module.
- Migrate interactive session streaming and `cli.ts` pipe-mode output.
- Add a lint rule that blocks ad-hoc `console.log` inside every
  migrated directory so the prohibition is mechanically enforced.

Phase 3 — peer-CLI capture (operator-facilitated):

- Run the scenarios pack through gemini-cli, codex, pi, and opencode on
  an operator workstation and pair the outputs in
  `.kota/runs/<run-id>/peer-cli/`. The scenarios script lives at
  `scripts/render-scenarios.mjs` so both sides share one input set.

