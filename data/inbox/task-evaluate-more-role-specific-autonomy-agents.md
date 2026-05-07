---
title: Evaluate more role-specific autonomy agents
created_at: 2026-05-07T12:27:35.000Z
source: owner
---

Owner question:

As the project grows, should KOTA have more natural role-specific agents rather
than treating most task execution as builder work?

Potential roles to research:

- Architect: plans architecture/system design before implementation when a task
  is broad or risky.
- Analyst: periodically reviews logs, commits, queue changes, and metrics, for
  example every 100 commits, then produces conclusions or follow-up work.
- Project manager: watches task progress, queue health, priorities, blocked
  items, and next-iteration focus.
- Researcher: follows resources/watchlists, reads links, creates research
  artifacts, and decides what should become tasks.
- Product/product-owner role: interprets research and owner intent before
  implementation planning.

Questions:

- Which roles should be real registered agents, and which are just workflow /
  hook behaviors?
- How much freedom should each role have to inspect, create, move, or assign
  work?
- Can role-specific agents improve scoping without adding too many guard rails
  or too much process?
- How should outputs be validated: tasks, research artifacts, metrics, or
  architecture notes?
- How does this interact with a possible events/hooks model?

Goal:

Make autonomy roles reflect the actual shape of work: research, analysis,
planning, implementation, verification, and queue management are not the same
job.

Initial research notes:

- KOTA already has first-class `AgentDef` declarations with `role`,
  `promptPath`, model/effort, skills, tool policy, and `writeScope`.
- Existing autonomy agent roles are `builder`, `explorer`, `improver`,
  `inbox-sorter`, `decomposer`, `pr-reviewer`, and `research-retry`.
  Several other workflows are deliberately code-only (`dispatcher`,
  backlog/blocked promoter, fan-out consolidator, attention/daily digests,
  evaluator calibration monitor/notify).
- External primary docs support specialist agents and explicit handoffs:
  - Claude Code subagents/hooks treat subagent completion and lifecycle hooks
    as separate surfaces:
    https://code.claude.com/docs/en/hooks
  - OpenAI Agents SDK handoffs let one agent delegate to another specialist
    with structured handoff inputs and filters:
    https://openai.github.io/openai-agents-python/handoffs/
  - LangGraph distinguishes deterministic workflows from dynamic agents:
    https://docs.langchain.com/oss/python/langgraph/workflows-agents
  - AutoGen Core uses topics/subscriptions to route broadcast messages to
    agent types:
    https://microsoft.github.io/autogen/dev/user-guide/core-user-guide/core-concepts/topic-and-subscription.html

Current assessment:

More roles are plausible, but not as a bulk role explosion. Add a role only
when it has a distinct durable output and write scope that current workflows do
not cover. Strong candidates to research are:

- Analyst: operator-facing periodic analysis over commits, run artifacts, and
  queue movement. This may be code/report first, not an agent.
- Researcher: durable source review and disposition. This overlaps with
  `explorer` and `research-retry`; the gap must be proven before adding a new
  agent.
- Architect: pre-builder design for broad/risky tasks. This overlaps with the
  existing `architect` module and with decomposer/builder task shaping.
- Project manager/product owner: queue triage and owner-intent interpretation.
  This overlaps with backlog/blocked promoter and inbox-sorter.

Revisit condition:

Create a real agent only after a concrete workflow shows that current agents
either overreach their write scope, mix incompatible duties, or fail repeatedly
because a missing specialist role would have produced a checkable artifact.
