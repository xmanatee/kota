---
status: done
---

# Make the package bin resilient to source-mode NODE_OPTIONS

## Problem

The documented task-management path in `data/tasks/AGENTS.md` says to use
`pnpm kota task create`, and workflow prompts also refer to `pnpm kota ...`
commands. In this run's source-mode environment, the package bin path fails
before reaching Commander:

```text
pnpm kota task --help
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'/Users/xmanatee/Desktop/mono/apps/kota/src/core/config/config-merge.js'
imported from /Users/xmanatee/Desktop/mono/apps/kota/src/core/config/config.ts
```

`dist/` exists, and `pnpm dev task --help` works because it runs
`tsx src/cli.ts` under the source condition. The failure shape is the package
bin boundary: `bin/kota.mjs` imports `../dist/cli.js`, while an inherited
`NODE_OPTIONS=--conditions=source` can make package `imports` resolve
`#core/*` to TypeScript source from the compiled dist process. The compiled
process then tries to import source sibling paths such as
`./config-merge.js`, which do not exist beside the `.ts` source file.

KOTA already has several tests and subprocess paths that explicitly clear
`NODE_OPTIONS` before spawning `node dist/cli.js`, but the operator-facing
`pnpm kota` / `bin/kota.mjs` entrypoint itself has no equivalent guard. That
leaves normal documented commands dependent on the caller remembering to run
`env -u NODE_OPTIONS pnpm kota ...`, which is brittle for workflows, eval
fixtures, service-installed dev runtimes, and local operators.

## Desired Outcome

`bin/kota.mjs` and the `pnpm kota` script behave predictably when launched
from a source-mode shell. If the launcher is about to load built `dist/` code,
it strips or neutralizes only the source-resolution condition that would make
compiled code import TypeScript source, while preserving unrelated safe Node
options such as memory limits or tracing flags.

The result should make the documented task CLI usable in both modes:

- production-style/dist launch with no `NODE_OPTIONS`;
- source-mode parent shells where `NODE_OPTIONS` includes
  `--conditions=source`; and
- the existing `pnpm dev ...` source entrypoint.

## Constraints

- Do not make compiled `dist/` code import `.ts` source at runtime.
- Do not globally discard every `NODE_OPTIONS` value if a narrower
  source-condition normalization is enough.
- Do not weaken the eval-harness subprocess executor's existing behavior that
  strips source-mode options before invoking the dist CLI.
- Keep the fix at the launcher/package-script boundary or a small shared helper
  with focused tests; do not redesign module import aliases.
- Preserve built CLI smoke tests that intentionally clear `NODE_OPTIONS` when
  they spawn `node dist/cli.js` from a source-mode Vitest parent.

## Done When

- `NODE_OPTIONS=--conditions=source pnpm kota task --help` exits 0 and prints
  the normal task command help.
- `env -u NODE_OPTIONS pnpm kota task --help` still exits 0 and prints the same
  command surface.
- `pnpm dev task --help` still exits 0 through the source entrypoint.
- A focused test or smoke fixture covers the package bin / launcher behavior
  so the regression does not rely on manual discovery in future workflow runs.
- Existing built CLI and eval-harness subprocess tests that exercise
  production-resolution launches still pass.
- `pnpm run validate-tasks -- --min-ready 0` passes.

## Source / Intent

Explorer run `2026-06-21T07-50-16-526Z-explorer-y9sath` reviewed a thin queue
with only one p3 ready task and a strategic coverage gap. The strategic blocked
alternatives exposed by `inspect-queue` all still require operator-captured
evidence and are not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

The run attempted to follow the task-queue contract by invoking
`pnpm kota task --help`; that failed with the source-condition/dist mismatch
above. `pnpm dev task --help` succeeded, so the task was scaffolded through the
source entrypoint as a workaround.

Local overlap check:

- `src/built-cli-daemon.integration.test.ts`,
  `src/built-cli-serve.integration.test.ts`, and
  `src/preset-parity.integration.test.ts` clear `NODE_OPTIONS` around child
  `node dist/cli.js` launches, but they do not prove `bin/kota.mjs` or
  `pnpm kota` is robust when the caller's shell already has source-mode
  `NODE_OPTIONS`.
- `src/modules/eval-harness/subprocess-executor.ts` already has a helper for
  removing `--conditions=source` before launching KOTA inside eval runs. The
  nonduplicative gap is applying the same production-resolution safety at the
  package bin/operator-command boundary.

## Initiative

Operator-command reliability: documented KOTA commands should work from the
same source-mode environments used by tests, workflows, eval fixtures, and
daemon development without requiring operators or agents to remember
out-of-band environment cleanup.

## Acceptance Evidence

- Transcript under `.kota/runs/<run-id>/` showing
  `NODE_OPTIONS=--conditions=source pnpm kota task --help` succeeds and prints
  the task command help.
- Transcript showing `env -u NODE_OPTIONS pnpm kota task --help` and
  `pnpm dev task --help` still succeed.
- Focused test transcript for the launcher/helper regression.
- Transcript for the relevant existing built CLI or eval-harness subprocess
  test that proves production-resolution launches still work.
- `pnpm run validate-tasks -- --min-ready 0` transcript.

Satisfied in run `2026-06-21T08-27-39-326Z-builder-7389gr`:

- `.kota/runs/2026-06-21T08-27-39-326Z-builder-7389gr/task-cli-help-transcript.txt`
- `.kota/runs/2026-06-21T08-27-39-326Z-builder-7389gr/focused-test-transcript.txt`
- `.kota/runs/2026-06-21T08-27-39-326Z-builder-7389gr/eval-harness-test-transcript.txt`
- `.kota/runs/2026-06-21T08-27-39-326Z-builder-7389gr/validate-tasks-transcript.txt`
