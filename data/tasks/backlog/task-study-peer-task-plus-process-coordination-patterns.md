---
id: task-study-peer-task-plus-process-coordination-patterns
title: Study peer task-plus-process coordination patterns and land an explicit adopt-or-reject decision
status: backlog
priority: p3
area: architecture
summary: Peer runtimes (crewAI, LangGraph, Vercel AI SDK, OpenHands, AutoGen successor) expose task-plus-process coordination primitives that KOTA does not; a written decision — adopt, reshape, or reject with rationale — keeps KOTA's workflow model deliberate rather than reactive.
created_at: 2026-04-20T10:25:25.863Z
updated_at: 2026-04-20T10:25:25.863Z
---

## Problem

KOTA coordinates autonomous work through workflows wired together by bus
events. That model is intentional — workflow routing is definition-driven and
event-shaped (see the routing guidance in
`src/modules/autonomy/workflows/AGENTS.md`). But several peer runtimes have
converged on a different shape: an explicit "task" primitive that carries
description, expected output, and assigned agent, paired with a "process"
primitive that expresses sequential / hierarchical / conditional coordination
as first-class configuration rather than as bus-event wiring.

- crewAI: `Agent` + `Task` + `Process` (sequential, hierarchical, delegation)
  composed by a `Crew`, plus a `Flows` layer with `@router`, `or_`, `and_`
  decorators for conditional state-machine control.
- LangGraph: Pregel-style graph of nodes with durable execution and
  resume-through-failure semantics.
- Vercel AI SDK: `ToolLoopAgent` plus strict separation of server-side tool
  loops from client-side presentation.
- OpenHands and the AutoGen successor line invest in typed multi-agent
  handoffs with explicit role boundaries.

KOTA's workflow + bus-event model already covers most of what these
primitives express, but the overlap has not been examined side-by-side.
Without an explicit decision, future work will either drift toward ad-hoc
"process"-shaped abstractions inside individual modules, or reject the
peer-pattern implicitly every time a new feature touches multi-agent
coordination. Both outcomes are worse than a deliberate written stance.

## Desired Outcome

- A short decision record lives in the repo at the narrowest useful place
  (likely `src/modules/autonomy/AGENTS.md` or a dedicated section within the
  autonomy module) capturing, for each pattern listed above, whether KOTA
  adopts it, adopts a reshaped form, or rejects it — and why. Rationale is
  load-bearing and must reference KOTA's existing primitives (workflow,
  agent, module, bus events, attention-digest) rather than arguing in
  peer-runtime vocabulary.
- If a peer primitive is judged worth adopting in reshaped form, the record
  names the concrete follow-up work (e.g. a new workflow step kind, a new
  event shape, a new module) and leaves a queued task. No speculative
  adoption in this task.
- If a peer primitive is rejected, the record states the specific KOTA
  property it would conflict with (module-first ownership, definition-driven
  routing, minimal-core boundary) so the same question does not need to be
  re-litigated next quarter.

## Constraints

- This is a written-decision task, not an implementation task. Any code
  change that goes beyond one short `AGENTS.md` update belongs in the
  follow-up work the decision names, not here.
- Use peer source material (README, design docs, AGENTS.md equivalents,
  linked papers) — not downstream marketing summaries — when characterizing
  each peer pattern. The explorer watchlist already points at the primary
  sources.
- Do not create a parallel "process" DSL inside KOTA as part of this task.
  If the decision is adopt-with-reshape, the reshaped form must fit the
  existing workflow / module / bus-event protocol, not sit beside it.
- Keep the decision record under ~50 lines. Longer decisions are almost
  always hiding multiple smaller decisions that should split.
- Do not let this task drift into a peer-runtime survey. One decision per
  peer pattern; a pattern that cannot be decided with the current evidence
  is rejected or deferred with a specific unblocking condition.

## Done When

- The decision record exists at a named location, with one entry per
  pattern listed in `## Problem` and each entry carrying a verdict and a
  one-paragraph rationale referenced to KOTA primitives.
- For any "adopt" or "adopt-with-reshape" verdict, a follow-up task exists
  in `data/tasks/` (not inline in this task) scoping the concrete work.
- The autonomy module's `AGENTS.md` hierarchy references the record so the
  decision is discoverable from the directory it affects.
- No code change lands in this task beyond the documentation write.
