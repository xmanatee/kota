---
id: task-add-cli-daemon-mode-project-selector-and-project-s
title: Add CLI daemon-mode project selector and project-scoped views
status: blocked
priority: p2
area: client
summary: Add a project selector and project-scoped views to the CLI daemon-mode commands so kota status, kota session, and kota events show one project at a time once the daemon hosts multiple project runtimes.
created_at: 2026-05-07T23:59:57.549Z
updated_at: 2026-05-08T00:00:09.090Z
---

## Problem

`kota status`, `kota session`, `kota events`, and the dashboard log readout
flatten state across whatever the daemon hosts. Once the daemon runs more
than one project (Variant A), the operator has no way to scope these
views or to switch the active project from the CLI without restarting
the daemon. The `daemon-ops` module currently builds its output from
single-project assumptions: `daemon-ops-operations.ts`, `status-cli.ts`,
`session-cli.ts`, and `events-cli.ts` all treat `projectDir` as global.

## Desired Outcome

The CLI daemon-mode surface gains a first-class project selector and
project-scoped views that consume the daemon's typed registry from the
sibling daemon-foundation task. Operators can:

- See which projects the daemon hosts and which one is currently
  selected (with an explicit "no selection — list scope" mode for
  cross-project commands that genuinely span all projects).
- Switch the selected project without restarting the daemon, via a
  typed control-API call.
- Run `kota status`, `kota session`, and `kota events` against one
  project at a time. Cross-project listings are an explicit opt-in,
  not the default.

## Constraints

- Consume the daemon's typed registry endpoints from the foundation
  task. Do not add a CLI-side project file or a `.kota/` reader.
- Use the existing `KotaClient` contract on `ModuleContext.client`. No
  bespoke daemon socket inside `daemon-ops`.
- `kota navigate` (the runtime navigator) inherits the selector through
  the same client; do not fork a parallel selection model.
- KOTA-on-itself with one project remains the same one-line experience.
  The selector does not appear when only one project is registered.
- Output flows through the `rendering` module's primitives. No bare
  `console.log` for operator-facing output.

## Done When

- `kota status` shows the active project's name and path in its header
  block when the daemon hosts more than one project.
- `kota session list/get` and `kota events --follow` accept a
  `--project <id>` flag and default to the currently selected project.
- A `kota project ls` (or equivalent under daemon-ops) lists configured
  projects and marks the active one.
- A `kota project use <id>` command switches the daemon's active
  project via the typed control API.
- The `daemon-ops` AGENTS.md is updated with the convention that
  project scope flows through the registry surface — no per-command
  reinventions.
- Tests cover the project-switch control path, the `--project` filter,
  and the no-selection / single-project default.

## Source / Intent

Decomposition of `task-surface-project-selection-in-operator-clients-for-`
(Variant A, resolved 2026-05-07). This is the first operator surface
needed to prove that one daemon hosting multiple projects is
supervisable in practice.

## Initiative

Multi-project operator supervision: one daemon hosts project-scoped
runtimes and every operator client sees project identity through the
same daemon control contract.

## Acceptance Evidence

- CLI transcript captured under `.kota/runs/<run-id>/transcript.txt`
  showing: a daemon configured with two projects, `kota project ls`,
  `kota project use <id>`, `kota status`, and `kota session list` —
  with the second project's sessions hidden once the first is selected.

## Unblock Precondition

```
kind: task-done
ref: task-add-daemon-project-registry-and-projectid-attribut
```

Promote this task to `ready/` when the daemon-foundation task lands in
`done/`. The CLI selector consumes that task's typed registry surface.
