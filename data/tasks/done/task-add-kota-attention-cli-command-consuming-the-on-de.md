---
id: task-add-kota-attention-cli-command-consuming-the-on-de
title: Add kota attention CLI command consuming the on-demand attention seam
status: done
priority: p2
area: modules
summary: Add a `kota attention` CLI command that runs the attention-digest detector on demand and prints the rendered attention items (or short "no attention items" body) to stdout, mirroring the just-landed Telegram /attention precedent and the established `kota digest` CLI surface so operators can pull attention items without scraping .kota/runs/.
created_at: 2026-04-26T07:22:47.124Z
updated_at: 2026-04-26T07:28:07.048Z
---

## Problem

The `attention-digest` workflow now exposes a pure
`renderOnDemandAttention({ projectDir, runsDir })` seam in
`src/modules/autonomy/workflows/attention-digest/step.ts` that returns
`{ items: AttentionItem[]; text: string }` without writing the cadence
counter (`<runsDir>/../attention-digest-counter.json`) and without
emitting `workflow.attention.digest`. Telegram `/attention` already
consumes that seam (commit `3090d2c6`).

The terminal surface does not. Operators on a workstation without a
Telegram client — and operators who run KOTA standalone — must still
wait for the next 10-cycle cadence push or scrape `.kota/runs/`,
`data/tasks/<state>/`, and the in-process owner-question state by hand
to learn what currently warrants attention. The `daily-digest` precedent
established `kota digest` (commit `ac5ba758`) as the terminal
counterpart to Telegram `/digest`, using the same on-demand seam,
emitting structured `--json` for scripts, and routing rendered text
through `src/modules/rendering/`. The same parity is missing for
attention.

## Desired Outcome

Running `kota attention` in a project directory prints the current
attention items in the same format the next cadence push would produce,
evaluated against live repo state at request time. When no items
warrant attention, the command prints the short fixed
`NO_ATTENTION_ITEMS_TEXT` body so operators can distinguish "nothing
wrong" from "command failed". A `--json` flag emits the structured
`AttentionItem[]` payload (and the rendered text) for scripts. The
command is read-only: it does not advance the cadence counter, does not
emit `workflow.attention.digest`, and does not touch any other on-disk
state.

## Constraints

- Implement the command in
  `src/modules/autonomy/workflows/attention-digest/attention-cli.ts`
  alongside the existing `step.ts` and any other co-located surfaces.
  The autonomy module's `commands: () => [...]` array
  (`src/modules/autonomy/index.ts`) registers it next to
  `buildDigestCommand`.
- The command resolves `projectDir` through
  `resolveProjectDir()` and resolves `runsDir` as
  `join(projectDir, ".kota", "runs")`, matching the cadence step's
  layout.
- Human-facing output flows through `src/modules/rendering/` (`text` +
  `plain` + `print`). The `--json` path uses
  `process.stdout.write(JSON.stringify(...))` per the rendering
  contract on structured surfaces.
- The on-demand call must not write
  `<runsDir>/../attention-digest-counter.json` and must not emit
  `workflow.attention.digest`. Co-located unit tests assert both
  invariants.
- The on-demand body is operator-facing only and must not be exposed
  to autonomy agents in any prompt path. Mirror the agent-feed
  exclusion captured in
  `src/modules/autonomy/workflows/daily-digest/AGENTS.md` and
  `src/modules/autonomy/workflows/attention-digest/AGENTS.md`.
- Render parity check: when items exist, the printed body matches what
  the cadence path would emit for the same `(projectDir, runsDir)`
  state — i.e. `renderOnDemandAttention(...).text`,
  character-for-character. When no items exist, the printed body is
  exactly `NO_ATTENTION_ITEMS_TEXT` followed by one trailing newline
  from the rendering transport.
- No new public dependency on the cadence step's runtime: the CLI
  imports only `renderOnDemandAttention` (and the
  `NO_ATTENTION_ITEMS_TEXT` constant if asserted in tests). The
  cadence's `runAttentionDigestStep` and counter machinery stay
  untouched.
- No second CLI registration path. The command is contributed via the
  module's `commands` contributor only; do not add it to a separate
  CLI registry.

## Done When

- `src/modules/autonomy/workflows/attention-digest/attention-cli.ts`
  exposes `buildAttentionCommand(): Command` that returns a Commander
  command named `attention` with a `--json` flag.
- `src/modules/autonomy/index.ts`'s `commands: () => [...]` array
  includes `buildAttentionCommand()` next to `buildDigestCommand()`.
- A co-located `attention-cli.test.ts` covers: (a) the printed body
  matches `renderOnDemandAttention(...).text` for a fixture state with
  items, (b) the no-items branch prints `NO_ATTENTION_ITEMS_TEXT`,
  (c) `--json` emits the structured payload, (d) the cadence counter
  file at `<runsDir>/../attention-digest-counter.json` is not created
  and (e) `workflow.attention.digest` is not emitted on the bus during
  either invocation.
- The autonomy module's local `AGENTS.md` (or the
  `attention-digest/AGENTS.md` if the CLI lives there in convention)
  cross-references the seam, the operator-pull surface, and the
  agent-feed exclusion at the conventions level — without enumerating
  individual surfaces.
- `pnpm test` and `pnpm typecheck` pass on the changed module.

## Source / Intent

The just-landed `task-add-telegram-attention-command-exposing-on-demand-`
(commit `3090d2c6`) established the on-demand attention seam and the
Telegram pull surface. Its Source / Intent paragraph explicitly
identifies the next surfaces — verbatim: "Subsequent surfaces (`kota
attention`, `/api/attention`, web/macOS/mobile attention panels) can
follow as their own follow-up tasks once the seam is in place." The
`daily-digest` initiative completed exactly this fan-out, in this same
order, across seven surfaces (Telegram → CLI → daemon HTTP → web →
macOS → mobile → push). The terminal CLI surface is the next step in
the established cadence and the highest-leverage one for an operator
running KOTA standalone, because it requires no client app and no
network round-trip.

## Initiative

Operator observability for autonomous KOTA operation: every
operator-facing surface should answer "what's the system doing right
now" and "what currently warrants attention" without the operator
scraping `.kota/runs/`. `kota attention` is the terminal pull surface
mirroring the just-landed Telegram `/attention`, continuing the
attention-digest fan-out toward parity with the daily-digest pull
pattern.

## Acceptance Evidence

- A live-run transcript under `.kota/runs/<run-id>/` showing
  `kota attention` printed against a real or fixture-seeded repo state,
  side-by-side with the seam's `renderOnDemandAttention(...).text` to
  prove parity.
- Co-located unit tests in
  `src/modules/autonomy/workflows/attention-digest/attention-cli.test.ts`
  exercising the parity, no-items, `--json`, no-counter-write, and
  no-bus-event invariants and passing on `pnpm test`.
- Confirmation that
  `<runsDir>/../attention-digest-counter.json` is unchanged after an
  on-demand call (recorded in the run artifact, mirroring the
  Telegram `/attention` evidence pattern).
