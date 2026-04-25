---
id: task-land-notification-delivery-channel-so-autonomous-w
title: Land notification-delivery channel so autonomous workflows can ask_owner again
status: blocked
priority: p2
area: autonomy
summary: Re-enable ask_owner from autonomous workflow steps by providing a notification-delivery channel that reliably surfaces the question to an operator within a practical budget, so the current recorded-and-expired pattern stops wasting $ and wall-clock.
created_at: 2026-04-25T00:17:31.642Z
updated_at: 2026-04-25T00:49:16.866Z
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

## Blocker

This task is blocked because the most expensive constraint —
"the autonomy step-runner must survive a process restart during a
pending question; resume is append-log + event replay, not a held
`await`" — combined with "no backwards-compatibility dual path"
requires a workflow primitive that does not exist yet. Investigation
on 2026-04-25 found:

- The notification-delivery surface the title invokes is already
  wired. `src/modules/telegram/index.ts`, `src/modules/slack/index.ts`,
  `src/modules/webhook/index.ts`, and `src/modules/email/index.ts`
  all subscribe to `owner.question.asked` and forward to operators
  with answer/dismiss controls. So channel coverage is not the
  remaining gap; the AGENTS.md text "Re-enable only after a
  notification-delivery channel lands" is misleading and is being
  corrected as part of this reshape.
- The genuine remaining gap is restart-resilience for the wait/resume
  boundary. Today `src/core/tools/ask-owner.ts` polls the queue in a
  held in-memory `await`. If the process dies mid-wait the agent
  session dies with it — no append-log, no event replay, no resume.
  Making the existing tool restart-safe in place violates the
  task's "Resume is append-log + event replay, not a held `await`"
  constraint.
- The architecturally honest fix is a new workflow-step primitive:
  an `await-event` step that records its waiting state to disk,
  subscribes to a typed event (filtered by id), and on daemon
  restart scans persisted waits and resubscribes — driving resume
  from the workflow runtime rather than from inside an agent's tool
  loop. Once that primitive exists, autonomous escalation becomes a
  step-shaped pattern (`ask` → `await-event` → `consume`) instead of
  an inside-the-tool-loop blocking call, and the restart, answered,
  and timed-out outcomes all reduce to the new primitive's contract.

Unblock by: land the pausable / await-event workflow step primitive
(seeded as `task-land-pausable-await-event-workflow-step-primitive`
in `ready/`). Once that primitive exists, this task splits into
three follow-ups that each fit a single builder run:

1. ~~Replace the in-tool `ask_owner` polling with the new step-shaped
   pattern, deleting the old held-await path (no dual path).~~
   **Done.** Landed by `task-convert-askowner-from-held-await-polling-to-await-`:
   `src/core/tools/ask-owner.ts` is now enqueue-only, the
   `askOwnerSteps` recipe in `src/core/workflow/ask-owner-step.ts`
   composes ask → await-event → consume on top of the pausable
   await-event primitive, and the three-outcome integration test
   (answered, dismissed, restart-during-wait) lives in
   `src/core/workflow/ask-owner-step.test.ts`.
2. Flip the `src/modules/autonomy/AGENTS.md` rule from "forbidden"
   to "allowed under the new step pattern", with explicit budget
   bounds and the typed `operator-unreachable` terminal.
3. Add the real-autonomy-workflow demo + the three-outcome
   integration tests against the wired channels.
