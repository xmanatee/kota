---
id: task-capture-an-end-to-end-coding-task-parity-artifact-
title: Capture an end-to-end coding-task parity artifact under .kota/runs/ for each registered agent harness
status: blocked
priority: p2
area: architecture
summary: Produce a run-dir artifact that shows KOTA completing a representative coding task end-to-end under each registered agent harness, recording any capability gap vs running the harness directly.
created_at: 2026-04-22T20:27:49.498Z
updated_at: 2026-04-22T21:19:48.379Z
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

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/harness-parity-*
description: live operator-facilitated harness-parity capture against every registered harness
```

## Source / Intent

Owner direction from the Claude/Codex-alternative inbox work asked KOTA to be
usable as a serious coding-agent wrapper across harnesses, not only as a
Claude-specific automation loop. This task preserves that product claim as an
evidence requirement instead of letting provider-neutral plumbing count as
parity by itself.

## Initiative

General-purpose coding agent parity: KOTA should prove real coding-task
completion through every registered harness, with any harness-specific gap
recorded as an explicit capability boundary.

## Acceptance Evidence

- Operator-runnable harness-parity scenario output under `.kota/runs/` pairs
  each registered harness with prompt, trace summary, diff, and verification.
- Any failed or text-only harness outcome names the capability gap and links to
  a follow-up task or an explicit non-blocking rationale.
- The CLI command that captures the artifact is documented enough for an
  operator to rerun the parity check without ad-hoc setup.

## Plan

Phase 1 — scenarios pack and operator-runnable CLI (this run):

- [done] Ship `src/modules/harness-parity/` with the scenario schema,
  runner, and CLI command. The runner reuses `runAgentHarness` — the
  same entry point the main `kota run` path uses — so paired evidence
  reflects operator reality rather than a parallel benchmarking
  framework.
- [done] Scenario fixture `fix-arithmetic-bug` ships with an `initial/`
  tree and a shell-exit verification predicate (`node test.js`). The
  same prompt and predicate are handed to every registered harness.
- [done] Operator-runnable surface via `kota harness-parity list` /
  `kota harness-parity run`, defaulting to every registered harness and
  every discovered scenario. Artifacts land under
  `.kota/runs/harness-parity-<stamp>/<scenario>/<harness>/`.
- [done] Per-harness artifacts include `prompt.txt`, `trace.txt`,
  `trace-summary.md`, `diff.patch`, `verification.json`, and
  `run-meta.json`. A per-scenario `parity.json` summarizes outcomes
  across harnesses for direct comparison.
- [done] The module `AGENTS.md` documents the scenario layout, artifact
  shape, capability-gap handling, and the explicit non-goals (no
  scoring, no regression gating — eval-harness concerns).

Phase 2 — operator-facilitated live capture (blocks the task):

- Run `kota harness-parity run` against every registered harness on an
  operator workstation with credentials authorized for live API calls.
  Commit the resulting artifact tree under `.kota/runs/<run-id>/harness-parity/`
  so Done-When bullet 2 can be honestly verified.
- The autonomous builder ships the infrastructure but does not itself
  capture paired artifacts: each live run consumes real API budget and a
  nested claude-agent-sdk invocation from inside another claude-agent-sdk
  session is operationally unsafe. Unblock by either committing live
  evidence or by narrowing Done-When to drop the paired-artifact
  requirement.
- Anticipated capability gap (record inline if still true at capture
  time): the `thin` harness is single-turn and text-only, so it cannot
  apply file edits. The scenario predicate will fail against its
  working directory while the adapter's streamed text may contain a
  reference patch proposal. That gap is inherent to the harness's
  declared contract and does not block "coding-agent parity" — it
  delineates which registered harnesses are coding-capable rather than
  text-only.
