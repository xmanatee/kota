---
id: task-add-a-frontend-preview-scenario-to-harness-parity
title: Add a frontend preview scenario to harness parity
status: ready
priority: p2
area: modules
summary: Extend harness-parity with a deterministic local web-app scenario and preview artifact so cross-harness coding evidence covers rendered UI work, not only Node CLI fixtures.
created_at: 2026-05-18T08:43:44Z
updated_at: 2026-05-18T08:43:44Z
---

## Problem

`src/modules/harness-parity/` now records strong paired evidence for ordinary
coding tasks: smoke edits, multi-file helper extraction, failure-and-revision,
project discovery, and cross-file rename discipline. All five shipped scenarios
still reduce success to a Node CLI assertion. That leaves a real operator gap:
modern coding agents are often asked to change a local web UI, run a dev or
preview server, inspect what rendered, and leave an artifact that proves the UI
state.

The current harness-parity surface can say whether a harness can edit files and
pass tests, but not whether it can handle previewable UI work without losing the
server / rendered-output loop. A text-only or native harness may pass the
existing fixtures while still failing the workflow shape operators use for
frontend changes.

## Desired Outcome

Harness parity includes one deterministic frontend-preview scenario. The
scenario should be small and dependency-light: a local static web app or tiny
Node-served page with an intentional UI bug, a prompt that asks the agent to fix
the rendered behavior, and a verification command that starts a loopback preview
server, checks the rendered DOM/CSS-visible state, and writes a preview artifact
such as `preview.html` plus a structured `preview-check.json`.

The runner should preserve any declared preview artifacts beside the existing
per-harness artifacts so an operator comparing harnesses can inspect the
rendered result from the same place they inspect `trace-summary.md`,
`trajectory.json`, `diff.patch`, and `verification.json`.

## Constraints

- Keep this inside the harness-parity module. Do not add a parallel benchmark,
  preview server framework, or managed sandbox abstraction.
- Keep the scenario deterministic and local. No provider calls, external
  network, package installs, or Playwright requirement should be needed to run
  the verification command.
- If the runner needs new scenario metadata for preview artifacts, make it typed
  and strict. Artifact paths must be relative to the scenario working directory,
  bounded, and copied only after verification runs.
- Preserve the five existing scenario coverage points documented in
  `src/modules/harness-parity/AGENTS.md`. This task adds a sixth coverage point;
  it does not replace smoke, multi-file, failure-and-revise, discovery, or
  rename coverage.
- Keep preview output operator-facing only. Do not feed rendered artifacts back
  into agent prompts or scoring logic.

## Done When

- A new harness-parity scenario, for example
  `src/modules/harness-parity/scenarios/frontend-preview/`, ships with an
  `initial/` tree, `scenario.json`, and a verification command that writes a
  preview artifact proving the rendered UI state.
- The scenario loader and runner preserve declared preview artifacts under each
  harness artifact directory and expose their paths in `run-meta.json` or
  `parity.json` so operators do not have to inspect a deleted temporary working
  directory.
- Focused tests cover scenario metadata validation, preview artifact capture,
  missing/bad artifact handling, and the new scenario appearing in scenario
  discovery.
- `src/modules/harness-parity/AGENTS.md` documents the frontend-preview coverage
  point at the same convention level as the existing five scenarios.

## Source / Intent

Explorer run `2026-05-18T08-40-39-704Z-explorer-tyqsfl` found no actionable
ready or doing work. The two backlog tasks are dependency-waiting on
`task-enable-autonomous-access-to-auth-walled-sources-so`; the strategic
blocked alternatives are all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add a frontend preview scenario to harness parity" --state ready --area modules --priority p2 --summary "Extend harness-parity with a deterministic local web-app scenario and preview artifact so cross-harness coding evidence covers rendered UI work, not only Node CLI fixtures."
```

It failed before writing a file with `Fatal: fetch failed`, so this normalized
task was created manually.

External signal checked:

- https://github.com/vercel-labs/open-agents currently presents background
  coding agents as a web app -> durable agent workflow -> sandbox VM shape, with
  sandbox execution, preview ports, streaming, cancellation, repo branching, and
  optional PR creation. KOTA should not copy the managed cloud sandbox model,
  but the preview-port evidence shape is a useful gap check for
  harness-parity.

Local inspection found:

- `src/modules/harness-parity/AGENTS.md` documents five valuable scenario
  coverage points, all CLI/test-oriented.
- `src/modules/harness-parity/scenario.ts` supports strict scenario metadata
  with one verification command.
- `src/modules/harness-parity/runner.ts` already writes per-harness artifacts
  after verification, so preview artifacts can be added without inventing a
  second runner.

## Initiative

Harness-parity evidence quality: KOTA should compare coding harnesses on the
workflow shapes operators actually delegate, including local UI preview work,
while keeping one harness-parity runner and one artifact contract.

## Acceptance Evidence

- Focused test transcript for
  `pnpm test src/modules/harness-parity/scenario.test.ts src/modules/harness-parity/runner.test.ts`.
- A harness-parity test artifact or fixture showing the frontend-preview
  scenario writes `preview.html` and `preview-check.json` under a per-harness
  artifact directory.
- `parity.json` or `run-meta.json` in the same test output references the
  preserved preview artifacts.
