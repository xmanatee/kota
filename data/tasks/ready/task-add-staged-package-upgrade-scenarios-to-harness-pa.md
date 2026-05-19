---
id: task-add-staged-package-upgrade-scenarios-to-harness-pa
title: Add staged package-upgrade scenarios to harness parity
status: ready
priority: p2
area: modules
summary: Extend harness-parity with a staged package-upgrade scenario whose release-note prompts build on the same working tree, so paired harness evidence covers chained maintenance work rather than only one-shot fixes.
created_at: 2026-05-19T22:25:54Z
updated_at: 2026-05-19T22:25:54Z
---

## Problem

`src/modules/harness-parity/` now compares registered agent harnesses across
useful one-shot coding scenarios: smoke, multi-file, failure-and-revise,
project discovery, cross-file rename, and frontend preview. Each scenario
still materializes one initial tree, sends one prompt, and runs one verification
command.

That misses a common maintenance shape: package or API upgrades that arrive as
a chain of release notes where each transition inherits the agent's prior
edits. A harness can pass a one-shot refactor while still accumulating broken
compatibility shims, stale call sites, or partial migrations when the next
upgrade builds on the same codebase. KOTA's parity evidence should cover that
longer-horizon maintenance shape without importing a full external benchmark.

## Desired Outcome

Harness parity supports a strict staged scenario contract and ships one
deterministic package-upgrade chain. The scenario starts from a small local
package-like fixture and applies two or three release-note prompts in sequence
against the same harness working tree. Each stage records the prompt, diff,
verification result, and changed files, and the final stage proves earlier
behavior did not regress.

The existing single-stage scenarios remain valid. Staged scenarios are an
extension of the same harness-parity runner and artifact directory, not a
second benchmark or scoring framework.

## Constraints

- Keep ownership in `src/modules/harness-parity/`; do not move scoring or
  regression gating into this module.
- Preserve every existing scenario coverage point documented in
  `src/modules/harness-parity/AGENTS.md`.
- Make staged metadata typed and strict. Stage ids, prompt text, verification
  commands, timeouts, and optional copied artifacts should validate before any
  harness runs.
- Run all stages for a harness against one materialized working tree so the
  second stage inherits the first stage's edits.
- Keep the fixture deterministic and local: no external network, package
  installs, provider-specific assumptions, or Playwright dependency.
- Artifact output must make per-stage failures inspectable without requiring an
  operator to reconstruct intermediate trees manually.

## Done When

- The harness-parity scenario loader accepts both the current single-stage
  shape and one strict staged shape with clear validation errors for malformed
  stage definitions.
- The runner executes staged scenarios sequentially per harness, preserving the
  working tree between stages while still isolating each harness in its own
  temporary copy.
- Per-harness artifacts include per-stage prompts, trace summaries, diffs,
  verification records, and a compact staged summary in `parity.json` or
  `run-meta.json`.
- A new package-upgrade scenario ships under
  `src/modules/harness-parity/scenarios/`, with release-note-style prompts and
  a final verification command that catches both the latest upgrade and an
  earlier-stage regression.
- Focused tests cover staged scenario discovery, metadata validation,
  sequential execution, per-stage artifact capture, failure reporting, and
  backwards compatibility for existing single-stage scenarios.
- `src/modules/harness-parity/AGENTS.md` documents staged package-upgrade
  coverage as an additional coverage point at the same convention level as the
  existing six.

## Source / Intent

Explorer run `2026-05-19T22-23-33-570Z-explorer-se52v0` reviewed an empty
actionable queue. The only backlog tasks were dependency-waiting on
`task-enable-autonomous-access-to-auth-walled-sources-so`; the strategic
blocked alternatives were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add staged package-upgrade scenarios to harness parity" --state ready --area modules --priority p2 --summary "Extend harness-parity with a staged package-upgrade scenario whose release-note prompts build on the same working tree, so paired harness evidence covers chained maintenance work rather than only one-shot fixes."
```

It failed before writing a file with `Fatal: fetch failed`, so this normalized
task was created manually.

External signal checked:

- `https://arxiv.org/abs/2605.14415` (SWE-Chain, submitted 2026-05-14) frames
  chained release-level package upgrades as a coding-agent evaluation gap:
  each version transition builds on the agent's prior codebase, and current
  frontier agents still struggle to carry correct upgrades through a chain
  without breaking existing functionality.

Local inspection found:

- `src/modules/harness-parity/AGENTS.md` documents six valuable scenario
  coverage points, all single-prompt / single-verification shapes.
- `src/modules/harness-parity/` is already the right operator-facing parity
  surface for comparable agent-harness evidence, while `eval-harness` owns
  scoring and regression gates.
- Existing task search showed no current package-upgrade or release-chain
  scenario task.

## Initiative

Harness-parity evidence quality: KOTA should compare coding harnesses on
maintenance workflows where correct behavior must survive a sequence of
dependent edits, not only isolated one-shot fixes.

## Acceptance Evidence

- Focused test transcript for the staged scenario loader and runner, for
  example `pnpm test src/modules/harness-parity/scenario.test.ts src/modules/harness-parity/runner.test.ts`.
- A local harness-parity artifact under `.kota/runs/<run-id>/` showing the
  package-upgrade scenario's per-stage prompts, diffs, verification records,
  and final staged summary.
- Queue validation passes with the new ready task and no duplicate task id.
