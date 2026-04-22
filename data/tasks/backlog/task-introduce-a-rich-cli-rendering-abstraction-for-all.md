---
id: task-introduce-a-rich-cli-rendering-abstraction-for-all
title: Introduce a rich CLI rendering abstraction for all terminal output
status: backlog
priority: p2
area: modules
summary: Replace ad-hoc console printing with a dedicated rendering layer (library or module) used by daemon mode, CLI mode, and every surface, inspired by gemini-cli / codex / pi / opencode.
created_at: 2026-04-22T16:46:53.748Z
updated_at: 2026-04-22T16:46:53.748Z
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
