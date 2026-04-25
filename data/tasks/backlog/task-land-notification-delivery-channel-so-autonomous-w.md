---
id: task-land-notification-delivery-channel-so-autonomous-w
title: Land notification-delivery channel so autonomous workflows can ask_owner again
status: backlog
priority: p2
area: autonomy
summary: Re-enable ask_owner from autonomous workflow steps by providing a notification-delivery channel that reliably surfaces the question to an operator within a practical budget, so the current recorded-and-expired pattern stops wasting $ and wall-clock.
created_at: 2026-04-25T00:17:31.642Z
updated_at: 2026-04-25T00:17:31.642Z
---

## Problem

`src/modules/autonomy/AGENTS.md` records the current rule: "No
`ask_owner` from autonomous workflow steps. Every recorded autonomous
call expires unanswered (`.kota/owner-questions/*.json`) after ~10 min
of wasted wall-clock... Re-enable only after a notification-delivery
channel lands." The ban protects real budget — recorded expirations
burn ~$X of vendor credit per incident plus 10 minutes of session
wall-clock — but it also permanently disables `ask_owner` as an escape
hatch for constraint conflicts, external blockers, and scope ambiguity
inside autonomous runs. Today every such situation has to be reshaped
into a `blocked/` task by the in-progress agent, even when a one-line
operator answer would unblock the run in seconds. Meanwhile the pieces
that could surface an owner-question to a real operator already exist
in pieces across `src/modules/owner-questions/`, `src/modules/telegram/`,
`src/modules/slack-channel/`, `src/modules/webhook/`, `src/modules/email/`,
and the shared `src/modules/notification/` primitive — they just do not
add up to a reliable "ping the operator; wait with a bounded budget;
resume on answer" flow the agent loop can rely on.

## Desired Outcome

`ask_owner` is safely callable from autonomous workflow steps. When an
autonomous agent opens a question, the operator is notified through at
least one configured delivery channel (telegram, slack, webhook, or
email) with enough context to answer; the agent's session waits within a
bounded time/cost budget and resumes the moment the answer arrives; the
recorded-and-expired `.kota/owner-questions/*.json` pattern is either
gone or converted into an honest "operator unreachable within budget"
terminal state rather than silent waste. The `autonomy/AGENTS.md` rule
is updated to describe the re-enabled behavior and its bounds.

## Constraints

- Build on the existing `owner-questions` queue and the existing
  `notification` + channel modules. Do not introduce a parallel
  notification registry or a second delivery primitive.
- Delivery channels stay module-owned. The autonomy module consumes a
  typed "question opened" event; it does not know channel-specific
  formatting or config.
- The wait/resume boundary must respect KOTA's existing autonomy-mode,
  approval-queue, and injection-defense protocols. Operator answers are
  untrusted payload and flow back through `injection-defense`.
- Budget bounds are explicit and typed: a question carries a
  time-budget (default short, e.g. 15 min) and either resumes on answer
  or resolves to a typed `operator-unreachable` terminal, not to
  silent expiration.
- Autonomous runs must not be allowed to call `ask_owner` in a loop
  that re-opens the same question; the queue owns deduplication across
  a single run.
- The autonomy step-runner must survive a process restart during a
  pending question — the answer delivery path cannot assume the
  original session process is still alive. Resume is append-log + event
  replay, not a held `await`.
- No backwards-compatibility dual path. Once landed, the autonomy rule
  flips from "forbidden" to "allowed under this contract" and the
  old ~10-min expiration code path is removed.

## Done When

- A `ask_owner` call from inside an autonomous workflow step either
  reaches the operator through at least one configured channel and
  delivers the answer back to the agent, or resolves to a typed
  `operator-unreachable` terminal within a bounded budget.
- `src/modules/autonomy/AGENTS.md` replaces the current
  "No `ask_owner` from autonomous workflow steps" rule with the new
  contract and its bounds.
- At least one real autonomy workflow (e.g. `decomposer` when a
  constraint conflict would otherwise force a `blocked` move) uses the
  re-enabled path and produces a run artifact showing question →
  answer → resume.
- Integration tests cover all three outcomes (answered, timed out,
  restart-during-wait) against at least one configured channel.
- Channel-specific configuration lives in each channel's module; the
  autonomy path does not hard-code a channel name.

## Source / Intent

This task preserves the owner-directed limitation currently documented
in `src/modules/autonomy/AGENTS.md`: the ban on autonomous `ask_owner`
was introduced because every recorded call was expiring unanswered and
wasting vendor budget, and the AGENTS.md explicitly states re-enabling
is the goal once a notification-delivery channel lands. The research-
retry / harness-parity / rendering / project-selection blocked tasks
all show the cost of having no owner-loop in autonomy: work that a
two-sentence operator answer could unblock instead stalls in
`blocked/` for days.

## Initiative

Recoverable operator loop: autonomous workflows should be able to pull
an operator in for one-line decisions through the same queue and
notification primitives clients use, without reintroducing the
recorded-and-expired waste that forced the current ban.

## Acceptance Evidence

- Integration test transcripts / artifacts for the three outcomes
  (answered, operator-unreachable terminal, restart-during-wait
  resume).
- A `.kota/runs/` artifact of a real autonomy workflow opening a
  question mid-run, receiving an answer, and completing its intended
  work.
- `src/modules/autonomy/AGENTS.md` diff showing the rule flip from
  "forbidden" to "allowed under contract X" with a link to the
  implementing module.
