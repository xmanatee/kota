---
id: task-add-kota-digest-cli-command-consuming-the-on-deman
title: Add kota digest CLI command consuming the on-demand digest seam
status: done
priority: p2
area: modules
summary: Add a 'kota digest' subcommand that emits the same on-demand operator digest the Telegram /digest command already produces, so operators on the terminal can pull a digest without depending on Telegram.
created_at: 2026-04-26T03:24:16.115Z
updated_at: 2026-04-26T03:34:37.265Z
---

## Problem

The `daily-digest` workflow now ships an on-demand seam
(`renderOnDemandDigest` in `src/modules/autonomy/workflows/daily-digest/
on-demand.ts`) and the Telegram channel consumes it through `/digest`
(`src/modules/telegram/status-poll.ts`). Operators on Telegram can pull
a current rollup any time. Operators on the terminal — the primary KOTA
operator surface — cannot. `kota daemon status` exists for live runtime
state, but there is no terminal-side counterpart to `/digest` for the
24h work rollup the daily-digest workflow already aggregates and
renders.

The on-demand seam was built specifically so the cadence run, the
Telegram surface, and any future operator-pull surface render an
identical body without drift. Leaving the terminal uncovered fragments
"what did KOTA do today?" across surfaces and forces operators on the
terminal to wait for the 08:00 cadence run before they can see the same
information.

## Desired Outcome

`kota digest` (text and `--json` output) prints the same on-demand
digest body the Telegram `/digest` command already produces. The body
flows through `src/modules/rendering` with the existing daily-digest
rendering primitives so theme/width/non-TTY handling matches the rest
of the operator CLI. The command is implemented as a module-contributed
CLI command; it does not write `.kota/daily-digest-state.json` and does
not emit `workflow.daily.digest`, preserving the snapshot and bus
invariants documented in
`src/modules/autonomy/workflows/daily-digest/AGENTS.md`.

## Constraints

- Reuse `renderOnDemandDigest` directly. Do not duplicate the
  aggregation or rendering pipeline.
- The command lives in the owning module, contributed via the standard
  `KotaModule.commands` factory. The candidate home is the autonomy
  module (which already owns the daily-digest workflow); do not add a
  parallel CLI registry. If the daily-digest workflow's directory is
  the cleaner home for the command file, contribute it from there
  while keeping the autonomy module's `commands` factory as the single
  registration point.
- Honor the on-demand invariants: no `.kota/daily-digest-state.json`
  write, no `workflow.daily.digest` emission, no `exposeOutputToAgent`
  path. The terminal command is operator-facing only and must not
  leak the digest body into autonomy agent prompts (no-cost-bias-in-
  autonomy memory).
- The text path renders through the rendering module's `print(...)` so
  theme + width + `NO_COLOR` apply uniformly with the rest of the
  daemon-ops CLI. The `--json` path emits the structured
  `DailyDigestData` shape directly via `console.log`, matching the
  module convention for machine-parseable output.
- Quiet-window labeling: when the seam reports a quiet window, the
  rendered body must show that distinctly (the seam already carries
  the `quiet` flag — surface it consistently with the Telegram
  rendering).
- No backwards-compatibility hooks. If a `kota digest` alias becomes
  necessary later, ship it as a real subcommand at that point.

## Done When

- `kota digest` outputs the same body Telegram `/digest` produces, plus
  a `--json` mode emitting the structured `DailyDigestData` shape.
- The command is contributed through a `KotaModule.commands` factory
  (autonomy or daily-digest workflow), not via direct registration in
  `src/cli.ts`.
- A focused unit test exercises the command's text and `--json` paths
  against a fixture project directory, asserting that the text body
  matches `renderOnDemandDigest` output and that no
  `.kota/daily-digest-state.json` write or `workflow.daily.digest`
  emission occurs.
- The command surface is documented at the narrowest applicable
  `AGENTS.md` (`src/modules/autonomy/workflows/daily-digest/AGENTS.md`
  on-demand seam section gains a one-line note that `kota digest` is
  the terminal consumer).
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-26T03-18-56-874Z-explorer-6cpm9j/` after the
`Add Telegram /digest command sharing the daily-digest aggregator+
renderer` commit (`68451bf5`) landed the on-demand seam and one
operator surface (Telegram). The terminal is KOTA's primary operator
surface and was left without a counterpart, so operators on the CLI
have no way to pull the same rollup before the next cadence run. The
on-demand seam was specifically designed so any pull-surface renders
the same body without drift; this task closes the missing surface.

## Initiative

Operator-pull parity for the daily digest: every primary operator
surface (Telegram, terminal, future web/native clients) shares one
on-demand digest body via `renderOnDemandDigest`, with surface-specific
delivery wired through standard module patterns rather than per-surface
duplication.

## Acceptance Evidence

- Diff covering the new `kota digest` command implementation, its
  contribution from a module's `commands` factory, and the focused
  test that asserts text-body equivalence with `renderOnDemandDigest`
  plus the no-write / no-emit invariants.
- Captured terminal transcript showing `kota digest` and `kota digest
  --json` output against a representative project directory, paired in
  the run directory with the corresponding Telegram `/digest` response
  rendered from the same project state to demonstrate body parity.
