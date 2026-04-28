---
id: task-add-built-cli-daemon-smoke-coverage-for-provider-b
title: Add built CLI daemon smoke coverage for provider-backed routes
status: ready
priority: p0
area: testing
summary: Add deterministic coverage that builds or invokes the shipped CLI daemon command and verifies provider-backed HTTP routes fail or pass for the right reasons, so direct new Daemon tests cannot mask commandsOnly startup bugs again.
created_at: 2026-04-28T22:35:13.394Z
updated_at: 2026-04-28T22:35:13.394Z
---

## Problem

Existing daemon tests exercise `new Daemon(...)` directly or daemon control
server units. That is useful, but it missed the real operator path:

`pnpm build && node dist/cli.js daemon`

The route-exposure test added with commit `68619f33` proved manually supplied
module routes can be served, but it did not prove the built CLI daemon command
loads modules in the same lifecycle mode. As a result, the daemon could look
healthy to `/status` while provider-backed routes failed in real use.

## Desired Outcome

The repo has deterministic smoke coverage for the shipped daemon command path,
not just in-process daemon construction. The smoke should catch the class of
bug where the daemon advertises routes or client capabilities that were derived
from a partial module load.

## Constraints

- Prefer a fast deterministic test that runs in CI without requiring real model
  credentials, network, or external services.
- It is acceptable to configure fixture providers or fake modules to prove
  `onLoad` ran; do not depend on a user's real knowledge/memory/history stores.
- Avoid fixed ports. Use the daemon control file or captured startup output to
  discover the chosen port and token.
- The test must invoke the built CLI entrypoint or an equivalent compiled
  command path. Do not only instantiate `new Daemon(...)`.
- Keep the smoke focused. It should prove startup lifecycle and provider-backed
  route readiness, not become a broad end-to-end workflow suite.

## Done When

- A test or scripted smoke starts the built daemon command in a temp project.
- The smoke authenticates through `.kota/daemon-control.json` and hits at least
  one route whose success depends on module `onLoad`.
- The smoke fails if routes are collected from `commandsOnly` state while
  provider initialization is skipped.
- The smoke shuts the daemon down cleanly and leaves no stale process, port, or
  `.kota` state behind.
- The test is wired into an appropriate validation command, or its cadence and
  reason for not being in the default gate are documented in scoped guidance.

## Source / Intent

2026-04-28 regression investigation found that the exact user command
`pnpm build && node dist/cli.js daemon` produced a daemon whose module routes
were present but provider-backed routes failed. Existing integration coverage
constructed `new Daemon(...)` directly and therefore skipped the CLI loader path
where `commandsOnly` caused the bug.

## Initiative

Shipped-command confidence: test the same command path operators and native
clients actually use.

## Acceptance Evidence

- Test output showing the new built-daemon smoke passing.
- A failure-mode note or fixture demonstrating that a `commandsOnly`-sourced
  daemon would fail the smoke.
- Proof the smoke cleans up its daemon process and temp project on success and
  failure.
