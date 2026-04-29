---
id: task-add-client-runtime-and-visual-evidence-gates-for-o
title: Add client runtime and visual evidence gates for operator surfaces
status: done
priority: p1
area: testing
summary: Make user-facing client work prove live rendered behavior, not just mocked decoding, by adding reusable screenshot/transcript/runtime evidence gates for macOS, mobile, web, Telegram, Slack, and CLI fan-out tasks.
created_at: 2026-04-28T22:35:56.055Z
updated_at: 2026-04-29T02:55:10.006Z
---

## Problem

Recent client fan-out tasks often required screenshots or rendered evidence, but
the run artifacts mostly contained build/test logs or textual branch
descriptions. The macOS menu bar accumulated UI and runtime defects despite many
green Swift tests because those tests were mostly mocked decoders/render helpers.

This weakness applies to all operator surfaces, not just macOS: web, mobile,
Telegram, Slack, CLI, and native clients need evidence that visible behavior
actually renders and that live daemon semantics work.

## Desired Outcome

User-facing client/channel tasks must produce verifiable runtime or rendered
evidence:

- screenshots for graphical clients when feasible;
- transcripts for CLI/chat clients;
- shared fixtures for exact rendered body parity;
- runtime probes when success depends on a daemon route or client/server
  interaction;
- critic/validator behavior that fails missing required evidence instead of
  accepting prose substitutes.

## Constraints

- Build on the existing backlog task
  `task-tighten-acceptance-evidence-for-client-and-channel`; do not create a
  parallel changelog.
- Keep enforcement scoped to visible client/channel changes. Internal refactors
  should not require screenshots.
- Support macOS realities: if automation cannot capture a native screenshot in
  CI, require a deterministic rendered view artifact or operator-capture
  precondition rather than accepting "not captured" silently.
- Prefer reusable evidence helpers over per-task bespoke scripts.
- The validator/critic must be precise enough not to create noisy false
  failures.

## Done When

- Task validation or critic checks detect missing rendered/runtime evidence for
  user-facing client/channel tasks that declare it.
- Fixtures cover at least one passing and one failing task.
- Evidence guidance names acceptable artifacts for macOS, mobile, web, CLI,
  Telegram, and Slack.
- At least one existing or new client task demonstrates the evidence path.
- The builder prompt/AGENTS guidance no longer allows "screenshots required" to
  be replaced by prose without a documented blocker or operator-capture
  precondition.

## Source / Intent

2026-04-28 investigation found zero image artifacts under `.kota/runs` despite
multiple done macOS tasks requiring screenshots. Several runs accepted text
documents describing branches instead. This let visual overload, broken
controls, and generic error presentation pass through green build/test gates.

## Initiative

Operator-visible quality gates: visible behavior must be reviewed through
visible/runtime artifacts.

## Acceptance Evidence

- Validator/critic test output showing a missing-evidence task fails and a
  properly evidenced task passes.
- Updated task/client/channel guidance.
- A sample run artifact demonstrating an accepted screenshot, transcript,
  fixture, or runtime probe.
