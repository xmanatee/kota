---
id: task-prove-external-project-autonomy-with-end-to-end-fi
title: Prove external-project autonomy with end-to-end fixture test
status: ready
priority: p2
area: architecture
summary: Add an integration test that boots the daemon against a fixture project distinct from KOTA's own tree and runs at least one autonomy workflow step there to completion, asserting file activity stays inside the fixture
created_at: 2026-04-18T15:48:03.953Z
updated_at: 2026-04-18T15:48:03.953Z
---

## Problem

The previously completed external-project task landed `DaemonConfig.projectDir`,
`resolveProjectDir()`, and per-module install root for workflow prompts, but
no integration test boots the daemon with a `projectDir` outside KOTA's own
source tree. Every existing integration test runs against KOTA's own repo, so
the claim "KOTA can operate on external projects" is unproven end-to-end.

## Desired Outcome

- An integration test boots the daemon with a `projectDir` that is a
  disposable fixture directory distinct from KOTA's own source, with its own
  minimal `data/tasks/` or trigger state.
- The test runs at least one autonomy workflow step (for example a trivial
  builder-compatible no-op workflow) to completion against that fixture.
- The test asserts that reads and writes during the run land inside the
  fixture directory, not the KOTA tree.

## Constraints

- Reuse the existing daemon and workflow runtime startup paths. Do not add a
  parallel "external project" entrypoint.
- Build the fixture project in `os.tmpdir()` (or a test-scoped directory) and
  clean it up on teardown. Do not check the fixture into `src/`.
- Do not weaken the module install-root resolution for shipped prompts.
- Do not introduce a test-only flag, hook, or override on the production
  daemon entrypoint to make the foreign-project case work.

## Done When

- A new integration test boots the daemon against a temp fixture
  `projectDir`, runs a workflow step to completion, and asserts file
  activity stays inside the fixture.
- The test fails loudly (not silently passes) if any read or write escapes
  the fixture and lands in the KOTA tree.
- No production entrypoint gains a test-only flag for this coverage.
