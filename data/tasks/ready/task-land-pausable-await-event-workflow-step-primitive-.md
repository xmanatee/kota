---
id: task-land-pausable-await-event-workflow-step-primitive-
title: Land pausable await-event workflow step primitive with restart-resume
status: ready
priority: p1
area: core
summary: Add a workflow-runtime primitive that lets a step suspend on a typed event id, persist its waiting state to disk, resubscribe on daemon restart, and resume the workflow from that boundary — the missing foundation for autonomous ask_owner that survives a process restart.
created_at: 2026-04-25T00:48:14.574Z
updated_at: 2026-04-25T00:48:14.574Z
---

## Problem

The autonomy umbrella task
`task-land-notification-delivery-channel-so-autonomous-w` is blocked
because making `ask_owner` safely callable from autonomous workflow
steps requires the wait/resume boundary to survive a process restart
("Resume is append-log + event replay, not a held `await`"), and
KOTA workflows do not have a primitive for that today. The notification
channels (telegram, slack, webhook, email) are already wired to
`owner.question.asked`, but `src/core/tools/ask-owner.ts` still polls
the queue in a held in-memory `await`. If the daemon dies mid-wait the
agent session dies with it; the question stays in
`.kota/owner-questions/` but no resume path picks the answer up.

The workflow runtime today only resumes between steps
(`run-executor-resume.test.ts` and `findResumeFromIndex` cover
between-step recovery). There is no step type or step extension that
records a mid-step "I am waiting for event X with id Y" boundary, so
no handoff between the dying session and a fresh one is possible.

## Desired Outcome

Workflows can declare a step that suspends on a typed bus event and
resumes when that event fires (matched by id), and that suspension
survives a daemon restart. The step persists its waiting state to disk
when it suspends; the workflow runtime, on restart, scans those
persisted suspensions, resubscribes, and either delivers the buffered
event payload immediately (if it arrived during the gap) or waits for
the next matching event. The step's output is the event payload the
workflow's later steps consume; the workflow itself drives the resume
through the existing run-resume path, not through a held `await`
inside the step.

## Constraints

- Persist suspension state inside the existing run directory under a
  dedicated subdirectory (e.g. `.kota/runs/<run-id>/awaits/`) so
  recovery uses the same disk surface as everything else workflow.
- The wake event subscription routes through the existing event bus.
  No second event-router primitive.
- Match the existing recovery contract in
  `src/modules/autonomy/workflows/AGENTS.md` (recovery is idempotent,
  reset-then-resume, no pre-reset network side effects). A workflow
  that uses the new primitive declares `recoveryCapable: true` and
  participates in the recovery trigger normally.
- Buffered-event delivery must be replay-safe: if the same id fires
  twice, the second delivery is a no-op (queue-side dedup, not
  receiver-side coercion).
- The new primitive must compose with the validation rails in
  `src/core/workflow/payload-validator.ts` and
  `src/core/workflow/steps/step-executor-retry.ts` — autonomy modes,
  retry classification, and write-scope all still apply.
- No silent-coercion fallbacks. If a persisted await references a
  workflow definition that has changed, the step fails loudly and the
  recovery path surfaces it as an honest failure rather than guessing.
- No backwards-compatibility dual path with the existing in-tool
  `ask_owner` polling — that conversion is the next task in the
  decomposition; this task only lands the primitive and a focused
  consumer-agnostic test surface.

## Done When

- A new workflow step type (or explicit extension to an existing
  type) supports `await event "<name>" matching id "<value>"`,
  declared in workflow definitions with the same code-shape as
  existing steps.
- Suspension persists state to `.kota/runs/<run-id>/awaits/<step>.json`
  and is durable across daemon restart.
- On daemon restart, the runtime discovers persisted awaits, replays
  any matching events that arrived since the previous shutdown, and
  resumes the workflow from the awaiting step's resume point using
  the existing run-resume path.
- Three integration tests cover: (a) event arrives while the daemon
  is alive — step resolves and the workflow continues; (b) daemon
  restarts mid-wait, event arrived during the gap — step resolves
  on restart from buffered/persisted delivery; (c) daemon restarts
  mid-wait, no event arrives, configured timeout fires — step
  resolves to a typed terminal output the workflow can branch on.
- `src/core/workflow/AGENTS.md` describes the new primitive's
  contract (suspension, persistence, restart behavior, timeout
  terminal) under the existing workflow protocol section.
- The umbrella task
  `task-land-notification-delivery-channel-so-autonomous-w` can
  reference this primitive as the foundation it was waiting on.

## Source / Intent

Surfaced on 2026-04-25 while reshaping
`task-land-notification-delivery-channel-so-autonomous-w`. Builder
attempted the umbrella, found that notification channels already
exist, and identified the actual blocker: the held-`await`
implementation in `src/core/tools/ask-owner.ts` cannot survive
process restart, and the umbrella's "no backwards-compatibility dual
path" constraint rules out an incremental fix. The architecturally
honest move is to land the missing primitive first and then split
the umbrella into restart-safe consumer + AGENTS.md flip + demo +
tests follow-ups.

## Initiative

Recoverable operator loop — the same initiative the umbrella task
declares. This primitive is the load-bearing foundation; it also
unlocks future operator-in-the-loop patterns beyond `ask_owner`
(scheduled approvals, paused experiments, manual gates) without
each one inventing its own restart story.

## Acceptance Evidence

- The three integration test transcripts described in `## Done When`,
  exercising the persistence + restart resume path against a fake
  consumer (no `ask_owner` rewrite required for this task).
- A short example workflow under
  `src/core/workflow/run-executor-resume.test.ts` (or sibling) that
  demonstrates definition-time declaration of an await-event step
  and shows the resumed run's `WorkflowStepResult` carrying the
  delivered event payload as its output.
- `src/core/workflow/AGENTS.md` diff describing the new primitive
  and its restart contract.
