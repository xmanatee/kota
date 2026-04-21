---
id: task-reduce-agent-progress-filler-in-run-logs
title: Reduce agent progress filler in run logs
status: backlog
priority: p3
area: autonomy
summary: Decide between prompt wording, output capture, or artifact summarization to bring the 'Now let me' / 'I will' filler density in recent runs down without suppressing useful final summaries
created_at: 2026-04-21T15:52:22.620Z
updated_at: 2026-04-21T15:52:22.620Z
---

## Problem

Workflow prompts already tell agents to work directly and skip narration, but
recent run metadata is still noisy with progress filler.

- A scan over recent run metadata found 44 of 180 runs contained phrases like
  "Now let me" or "I will", with 212 phrase hits total.
- Filler inflates token usage, adds noise to run artifacts, and makes
  operator review harder without improving outcomes.
- Useful closing summaries and tool evidence should not be collateral damage
  of a suppression rule.

## Desired Outcome

Filler density in run logs drops measurably, and the intervention is
localized to one layer rather than spread across every workflow prompt.

- Pick one mechanism — prompt wording, output capture, or artifact
  summarization — instead of shipping partial fixes in several places.
- Provide a simple "filler density" scan that can be rerun against
  `.kota/runs/` to confirm the reduction.

## Constraints

- Do not suppress final status summaries, explicit tool output, or critic /
  improver verdicts.
- Do not add per-prompt boilerplate; durable guidance already lives in
  `workflows/AGENTS.md`.
- If the fix is prompt-level, it should live in shared workflow prompt glue,
  not repeated in every workflow's `prompt.md`.

## Done When

- A single intervention is chosen and implemented with a short rationale
  note.
- A repeatable filler-density scan shows the metric dropping on runs recorded
  after the change, without collapsing final summaries to nothing.
- No new per-workflow duplication of "do not narrate" guidance.

