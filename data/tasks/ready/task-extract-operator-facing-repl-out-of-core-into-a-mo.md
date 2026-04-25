---
id: task-extract-operator-facing-repl-out-of-core-into-a-mo
title: Extract operator-facing REPL out of core into a module
status: ready
priority: p2
area: architecture
summary: Move src/core/repl/ into a module so core stops owning the operator-facing harness REPL; the launch path in src/cli.ts and the rendering-provided ReplChrome stay unchanged.
created_at: 2026-04-25T14:14:41.478Z
updated_at: 2026-04-25T14:14:41.478Z
---

## Problem

`src/core/repl/` hosts `runHarnessRepl`, the harness-neutral interactive
terminal client invoked when a CLI user runs `kota run -i` (or omits a
prompt for a multi-turn-capable harness). REPL is operator-facing terminal
UI: it owns banners, status, transcript composition, readline lifecycle,
and `@path` expansion at the user-input boundary. The core boundary in
`src/core/AGENTS.md` says "Do not add operator-facing feature code here
when it can live in a module" and the architecture rules say "Add an
operator or user-facing app: add a `client`." A REPL session is exactly
that surface.

The REPL already pulls its visual chrome from the rendering module via
`getRenderingProvider()`, so the heavy operator-UI bits already live
outside core. What remains in `src/core/repl/` is harness-neutral but
still operator-facing: the readline loop, slash-command handling, the
transcript composition, and the harness-launch wiring. Keeping that in
core makes core larger than its kernel role implies and means
operator-facing REPL behavior cannot be evolved under the module
contribution model.

## Desired Outcome

`src/core/repl/` is gone. The harness-neutral REPL lives in a module
under `src/modules/` and is the single owner of the interactive
terminal-REPL client surface. `src/cli.ts` still launches it via a
typed entry point — there is no parallel launch path. The rendering
module continues to provide `ReplChrome`; nothing about the
operator-visible behavior or `KOTA_RENDERER_THEME` /
`@path`-expansion / `/help` / `/status` / `/reset` semantics changes
for an operator running `kota run -i`.

The module is a clean home for future REPL evolution: typed slash
commands, multi-session navigation, contextual completion. Future work
that adds those capabilities should land in this module rather than back
in core.

## Constraints

- One module owns the REPL; do not split it across two modules. The
  rendering module continues to provide chrome through the existing
  provider seam — the new module depends on rendering, not the other
  way around.
- Pick the module name and home deliberately. The navigator backlog
  task (`task-add-interactive-runtime-navigator-as-a-cli-module`) plans
  to introduce `src/modules/cli/` for an interactive runtime navigator;
  if that module is the right home for the harness REPL too, place the
  REPL there and have the navigator task build on top. If the harness
  REPL is genuinely a different surface, choose a focused name (e.g.
  `src/modules/repl/`) and leave a one-line note in
  `src/modules/cli/AGENTS.md` (when it lands) about the boundary.
  Either way, do not create two parallel "operator interactive
  terminal" modules.
- Keep the harness-neutral protocol intact. The REPL must continue to
  refuse to launch for harnesses where `supportsMultiTurn === false`,
  must continue to expand `@path` references at the input boundary,
  and must continue to fail loudly (not silently degrade) when no
  `ReplChrome` can be resolved.
- `src/core/AGENTS.md` must lose its `repl/` subtree entry in the same
  change.
- `src/cli.ts` keeps a single launch site for the REPL. Do not
  introduce a second public entry point or a duplicate launcher under
  the new module.
- Existing tests in `src/harness-repl.integration.test.ts` and the
  unit tests in the existing REPL directory must keep covering the
  same behavior; relocate them with the code rather than rewriting
  the suite from scratch.
- This is not a behavior-change task. If a clean-slate rewrite of the
  REPL UX is wanted, file a follow-up — do not bundle it here.

## Done When

- `src/core/repl/` no longer exists. The harness-neutral REPL code
  lives under `src/modules/<chosen-name>/` with its own scoped
  `AGENTS.md`, the module exports a single typed launcher, and the
  module declares its dependencies (notably `rendering`).
- `src/cli.ts` calls the new module's launcher; `git grep -n
  "core/repl"` returns nothing.
- The integration test currently at
  `src/harness-repl.integration.test.ts` is either kept at the
  integration tier (with imports updated) or moved next to the new
  module. Whichever option is chosen, `src/root-layout.test.ts` still
  passes.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.
- Manual transcript: launching `kota run -i` against the default
  harness still shows banner, accepts a prompt, returns a streamed
  response, and exits cleanly on `quit`. Capture the transcript under
  the run directory.
- `src/core/AGENTS.md` no longer lists a `repl/` subtree under Core.

## Source / Intent

`src/core/AGENTS.md` (Core boundary): "Do not add operator-facing
feature code here when it can live in a module."
`AGENTS.md` (architecture / Single Way): "Add an operator or
user-facing app: add a `client`."

Repeated recent core-shrinking work (push-notification, web static
routes, scheduler routes, owner-questions handlers, approval
handlers, model-pricing seam, tracing metrics, webhook events) has
narrowed core to its kernel role for everything except a handful of
operator-facing features still living in `src/core/`. REPL is the
clearest of those remaining holdouts — it is operator UI, not a
runtime primitive — and the rendering provider seam already gives
us the extraction shape.

The navigator backlog task
(`task-add-interactive-runtime-navigator-as-a-cli-module`) makes the
question "where does the operator interactive terminal live?"
load-bearing: the navigator wants `src/modules/cli/`, and the harness
REPL is the same shape of thing. Settling the REPL extraction first
keeps the operator-CLI module surface clean when the navigator lands.

## Initiative

Module-first / core-shrinking: keep `src/core/` protocol-oriented and
move operator-facing capability — including interactive terminal
clients — into modules so the core boundary documented in
`src/core/AGENTS.md` reflects reality.

## Acceptance Evidence

- Diff showing `src/core/repl/` removed, the new module added with
  scoped `AGENTS.md`, `src/cli.ts` updated, and `src/core/AGENTS.md`
  updated to drop the `repl/` subtree entry.
- A transcript under `.kota/runs/<run-id>/` showing `kota run -i`
  launched against a registered multi-turn-capable harness, one user
  turn handled end-to-end, slash commands `/help` and `/status` shown,
  and a clean `quit` exit.
- Test output confirming `pnpm typecheck`, `pnpm lint`, and
  `pnpm test` are green.
- Grep evidence in the run directory that no source file under
  `src/` still imports `#core/repl/*` or `core/repl/`.
