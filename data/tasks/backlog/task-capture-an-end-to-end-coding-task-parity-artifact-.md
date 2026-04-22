---
id: task-capture-an-end-to-end-coding-task-parity-artifact-
title: Capture an end-to-end coding-task parity artifact under .kota/runs/ for each registered agent harness
status: backlog
priority: p2
area: architecture
summary: Produce a run-dir artifact that shows KOTA completing a representative coding task end-to-end under each registered agent harness, recording any capability gap vs running the harness directly.
created_at: 2026-04-22T20:27:49.498Z
updated_at: 2026-04-22T20:27:49.498Z
---

## Problem

The `AgentHarness` registry now exposes at least two adapters
(`claude-agent-sdk`, `thin`) and the CLI now delivers the same expanded
prompt to every adapter. What is not yet proven is that operators can
complete a real coding task end-to-end through KOTA under each harness
without a meaningful capability gap vs running the harness directly.
Without that evidence the "general-purpose coding agent across pluggable
harnesses" claim is aspirational.

## Desired Outcome

A runnable scenarios pack plus captured run-directory artifacts that show
KOTA completing a representative coding task end-to-end under each
registered harness adapter. Each artifact records the prompt, the active
harness and model, the turn-by-turn trace, final diff, and any capability
gap vs running the harness directly (e.g. native `claude-code` CLI or an
equivalent native runner for another adapter). Gaps are named explicitly and
either converted into follow-up tasks or explained why they do not block
"coding-agent parity".

## Constraints

- Use a real coding task whose success can be reduced to an inspectable
  artifact (tests passing, file diff, runtime probe). Do not rely on
  subjective "feels equivalent" judgments.
- Run each scenario under every registered harness and pair the results in
  one directory, exactly like the rendering task's peer-CLI comparison
  pattern.
- Do not introduce a parallel benchmarking framework. Reuse the existing
  `AgentHarness.run` path the CLI already calls.
- Operator-facilitated steps (if any harness requires human credentials or
  a non-headless runner) belong in a separate `blocked` bucket with an
  explicit enabler task, not in a silently skipped scenario.

## Done When

- A scenarios pack ships with at least one real coding task (code change
  plus verification) that can be run under every registered harness.
- `.kota/runs/<run-id>/harness-parity/` contains paired artifacts per
  harness with prompt, trace summary, diff, and verification result.
- Capability gaps found during the run are either named in a follow-up task
  or explained inline as non-blocking.
- The scenarios pack is reachable from the CLI or an operator-runnable
  script, not only from ad-hoc invocation.
