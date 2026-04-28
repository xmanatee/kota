---
id: task-version-external-pattern-decision-memory
title: Version external-pattern decision memory
status: backlog
priority: p2
area: modules
summary: Add a lightweight evidence and revisit protocol for autonomy AGENTS decisions that reject external patterns, so prompt memory stays useful without freezing old biases.
created_at: 2026-04-28T22:24:00.000Z
updated_at: 2026-04-28T22:24:00.000Z
---

## Problem

`src/modules/autonomy/AGENTS.md` contains many durable decisions about peer
agent patterns: workflow DSLs, LangGraph, CrewAI, managed agents,
strategy banks, parallel builders, Microsoft Agent Framework, harness-as-shell,
and more. These notes are useful architecture memory, but several are written
as permanent "Reject" verdicts.

That creates a bias risk. External systems evolve quickly. A prior rejection
may remain correct, but KOTA needs a protocol for evidence, scope, and revisit
conditions so autonomy does not freeze around stale conclusions.

## Desired Outcome

External-pattern decisions in autonomy instructions become versioned,
evidence-backed entries:

- Decision: adopt, reject, defer, reference-only.
- Source and date read.
- KOTA primitive(s) compared.
- Reasoning in one concise paragraph.
- Revisit condition: what would need to change for the verdict to be reopened.
- Owning subsystem/task if the decision creates work.

Explorer and improver can update the decision memory when new evidence changes
a verdict, but they must preserve concise prompts and avoid a second lessons
store.

## Constraints

- Do not add a separate research database. Keep this in scoped `AGENTS.md` or
  task/watchlist artifacts per existing autonomy rules.
- Do not turn `AGENTS.md` into a long literature review. Entries must stay
  decision-focused.
- Do not force churn for stable decisions. Add revisit conditions, not recurring
  calendar noise.
- Preserve existing high-value decisions unless new evidence directly changes
  them.

## Done When

- `src/modules/autonomy/AGENTS.md` external-pattern decisions follow a compact
  evidence/revisit format.
- Explorer prompt or AGENTS guidance requires new peer-pattern verdicts to use
  that format.
- At least five existing "Reject" decisions are rewritten with source/date and
  revisit condition.
- A test or review guard prevents adding a new external-pattern verdict without
  source/date/revisit fields.

## Source / Intent

2026-04-28 prompt/bias review found the workflow prompts are compact, but the
durable autonomy worldview is encoded in `src/modules/autonomy/AGENTS.md`,
including hard rejections of external approaches. The owner explicitly asked to
investigate prompts, biases, trends, and overengineering and to be unbiased.

External references checked in the review included MCP, LangGraph durable
execution, OpenAI Agents SDK handoffs/guardrails/tracing, Claude Code hooks and
subagents, and CrewAI Flows.

## Initiative

Unbiased autonomy research: keep durable architecture memory useful while
making stale external-pattern bias visible and correctable.

## Acceptance Evidence

- Diff of external-pattern decisions before/after with source/date/revisit
  fields.
- Fixture or guard failure for a new verdict missing required metadata.
- Explorer/improver guidance updated without lengthening role prompts.

