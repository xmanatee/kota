---
id: task-make-daemon-cli-output-product-grade-with-transcript
title: Make daemon CLI output product-grade with transcript regression evidence
status: ready
priority: p1
area: modules
summary: Fix the visible daemon status/activity output so copied terminal scrollback is clean, non-repetitive, width-safe, and covered by transcript fixtures.
created_at: 2026-04-24T00:00:00.000Z
updated_at: 2026-04-24T00:00:00.000Z
---

## Problem

The owner's long-running daemon transcript still shows product-surface
failures after earlier CLI rendering work: repeated full status blocks,
empty-looking `Work` sections, awkward activity/status boundaries, and prior
merged cells such as cost/defs running together. The broad rendering
abstraction task improved infrastructure, but the operator-visible daemon
experience still lacks an end-to-end acceptance target.

## Desired Outcome

`kota daemon` and daemon status/activity readouts produce professional,
scan-friendly terminal output that behaves well as live TTY output and as
copied scrollback. State, work queue, active/pending workflows, and last
activity should be visually distinct without nested decorative frames or
duplicated banners. The output should remain legible at common terminal widths
and should use the shared rendering module rather than ad-hoc formatting.

## Constraints

- Build on `src/modules/rendering/` and `src/modules/daemon-ops/`; do not add
  another terminal rendering abstraction.
- Keep machine-readable JSON and structured log paths explicit and unchanged.
- Use fixed transcript fixtures or pure render helpers for regression evidence;
  do not depend on a live daemon process for basic layout assertions.
- Treat the pasted owner transcript as a regression case. Do not mark this done
  while repeated full blocks, blank sections, or merged stat cells remain.
- Keep docs local to daemon/rendering conventions if behavior changes.

## Done When

- Daemon status/activity formatting has transcript fixtures or equivalent
  render-to-string assertions for at least 80-, 120-, and 160-column contexts.
- The regression scenario based on the owner's transcript shows clear section
  boundaries, no duplicated full status block for one activity frame, no blank
  `Work` section when counts are available, and no merged cost/defs output.
- Human-facing daemon output paths route through the shared rendering module
  with no new ad-hoc `console.log`/ANSI formatting in daemon-ops.
- A manual or scripted command captures the representative output artifact
  under the run directory or test fixture so future builders can inspect the
  actual terminal result.

## Source / Intent

Owner inbox captures on 2026-04-14, 2026-04-15, and 2026-04-22 explicitly said
the daemon/CLI output looked broken, ugly, and not like a serious CLI tool.
The 2026-04-24 daemon transcript confirms the issue survived earlier work.
This task keeps that operator pain as the acceptance target instead of
burying it inside the broader blocked rendering-comparison task.

## Initiative

Product-grade terminal UX: make KOTA's primary operator surface feel clean,
coherent, and trustworthy before broader peer-CLI comparison work continues.

## Acceptance Evidence

- Checked-in transcript/render tests cover the copied-scrollback daemon status
  scenario at multiple widths.
- The representative output artifact is human-readable and shows the corrected
  daemon status/activity layout.
- Search validation confirms daemon-ops did not add new ad-hoc user-facing
  console output or raw ANSI formatting outside the rendering module.
