---
id: task-convert-askowner-from-held-await-polling-to-await-
title: Convert ask_owner from held-await polling to await-event step pattern
status: ready
priority: p1
area: architecture
summary: Replace src/core/tools/ask-owner.ts in-tool polling loop with the workflow await-event step pattern (ask -> await-event -> consume), deleting the old held-await path so autonomous workflow steps can use ask_owner safely.
created_at: 2026-04-25T01:38:38.925Z
updated_at: 2026-04-25T01:38:38.925Z
---

## Problem

`src/core/tools/ask-owner.ts` still implements owner escalation as an
in-tool polling loop: `runAskOwner` enqueues a question and then sits in
a `while (clock.now() < deadline)` loop calling `queue.get(item.id)` and
`clock.sleep(POLL_INTERVAL_MS)` until the operator answers, dismisses,
or the ~10-min timeout expires. The agent's tool loop is held inside
this `await` for the entire duration. If the daemon process dies
mid-wait, the agent session dies with it — no append-log, no event
replay, no resume.

This is exactly why `src/modules/autonomy/AGENTS.md` currently bans
`ask_owner` from autonomous workflow steps: every recorded autonomous
call expires unanswered (`.kota/owner-questions/*.json`) after ~10 min
of wasted wall-clock and burns vendor credit either way. The umbrella
task `task-land-notification-delivery-channel-so-autonomous-w` is
blocked specifically on this restart-resilience gap.

The pausable await-event workflow step primitive landed in commit
`0254fe74` and is documented in `src/core/workflow/AGENTS.md`. The
primitive persists waiting state under
`.kota/runs/<run-id>/awaits/<step-id>.json`, registers a one-shot bus
listener, races a deadline, and resumes through the existing
run-resume path on daemon restart. The `await-event` step is the
foundation the umbrella task's `## Blocker` section names as the
prerequisite for re-enabling autonomous `ask_owner`. Nothing in the
core or autonomy modules consumes this primitive yet.

## Desired Outcome

Owner escalation from inside an autonomous workflow runs as a
step-shaped pattern (ask → await-event → consume) driven by the
workflow runtime, not by a held `await` inside the agent's tool loop.
The agent step that wants to escalate enqueues a question and ends;
the next workflow step is an `await-event` waiting on the typed
`owner.question.answered` (or equivalent) bus event, scoped to the
question id; the resume step consumes the answer payload and feeds it
back into the next agent step as part of its trigger envelope. The
old in-tool polling code path is deleted — no dual path, no
backwards-compatibility shim. After this lands, an autonomous workflow
that pauses for an owner answer survives a daemon restart mid-wait
without losing the question or the in-progress run.

## Constraints

- Build on the new `await-event` step primitive
  (`src/core/workflow/steps/step-executor-await-event.ts`,
  `src/core/workflow/awaits-resume.ts`,
  `src/core/workflow/awaits-store.ts`). Do not introduce a parallel
  pause/resume mechanism.
- The owner-question queue (`src/core/daemon/owner-question-queue.ts`)
  must emit a typed bus event when a question is answered, dismissed,
  or expired. The await-event step matches on `(field=questionId,
  value=<id>)`. The exact event name and payload field belong in code
  and tests, not docs.
- Delete `runAskOwner`'s `while`-loop polling and `POLL_INTERVAL_MS`
  constant. The tool entrypoint becomes "enqueue and return question
  id"; the wait is owned by the step primitive.
- Interactive sessions (`kota` chat) still need a way for an agent to
  escalate to the operator. Decide explicitly whether interactive
  sessions also flip to the step pattern or keep a thin
  poll-until-resolved adapter for the non-workflow case. Document the
  decision in `src/core/tools/AGENTS.md` (or the nearest scoped
  AGENTS.md) and back it with a focused test.
- Operator answers are untrusted payload. They flow back through
  `injection-defense` before being injected into the resuming agent
  step's trigger envelope.
- The autonomous-workflow ban in `src/modules/autonomy/AGENTS.md`
  stays in place until the follow-up "flip the rule" task lands. This
  task is the load-bearing primitive change; it does not by itself
  re-enable autonomous `ask_owner`.
- No new daemon side channel for owner answers. Delivery rides the
  existing event bus, scoped by question id.

## Done When

- `src/core/tools/ask-owner.ts` no longer contains the
  `while (clock.now() < deadline)` polling loop or
  `POLL_INTERVAL_MS`. The tool either enqueues a question and returns
  immediately (workflow case), or — if the interactive adapter is
  retained — does so via an explicit thin shim documented as the
  non-workflow escape hatch.
- The owner-question queue emits a typed answer/dismiss/expire event
  on the bus that an `await-event` step can match by question id.
- Either a new `askOwnerStep` helper or a documented step-pattern
  recipe in `src/core/workflow/AGENTS.md` shows how a workflow
  composes ask → await-event → consume, with a worked example used by
  at least one focused integration test.
- An integration test covers the three outcomes against the new step
  pattern: answered (resume payload reaches the next agent step),
  expired/dismissed (typed terminal output), and restart-during-wait
  (daemon restart mid-wait, then answer arrives, then resume).
- The umbrella task
  `task-land-notification-delivery-channel-so-autonomous-w` is updated
  to reflect that step 1 of its `## Blocker` follow-up plan is now
  done, and the next two follow-ups are seedable as separate tasks.

## Source / Intent

Captured directly from the `## Blocker` section of
`data/tasks/blocked/task-land-notification-delivery-channel-so-autonomous-w.md`:

> Once that primitive exists, this task splits into three follow-ups
> that each fit a single builder run:
> 1. Replace the in-tool `ask_owner` polling with the new step-shaped
>    pattern, deleting the old held-await path (no dual path).
> 2. Flip the `src/modules/autonomy/AGENTS.md` rule from "forbidden"
>    to "allowed under the new step pattern", with explicit budget
>    bounds and the typed `operator-unreachable` terminal.
> 3. Add the real-autonomy-workflow demo + the three-outcome
>    integration tests against the wired channels.

This task is step 1, the load-bearing prerequisite for steps 2 and 3.
The pausable await-event primitive landed in commit `0254fe74`; this
task is the first consumer of that primitive and the architectural
move that converts owner escalation from an in-agent-loop synchronous
wait to a workflow-runtime-owned pause.

## Initiative

Recoverable operator loop: autonomous workflows should be able to pull
an operator in for one-line decisions through the same queue, event
bus, and notification primitives clients already use, without
reintroducing the recorded-and-expired waste that forced the current
ban on autonomous `ask_owner`. Step 1 of three.

## Acceptance Evidence

- Diff of `src/core/tools/ask-owner.ts` removing the polling loop and
  the `POLL_INTERVAL_MS` constant, plus the new step-pattern entry
  point or recipe.
- Integration test transcript (or `.kota/runs/` artifact) for each of
  the three outcomes — answered, expired/dismissed terminal, and
  restart-during-wait — demonstrating that the resuming agent step
  receives the answer payload through the trigger envelope.
- Updated `data/tasks/blocked/task-land-notification-delivery-channel-so-autonomous-w.md`
  noting step 1 is complete and pointing to this task's commit.
