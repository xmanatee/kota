---
id: task-pin-the-owner-decision-blocked-task-unblock-cycle-
title: Pin the owner-decision blocked-task unblock cycle through an end-to-end integration test
status: done
priority: p2
area: autonomy
summary: Cover ask -> daemon-restart -> free-form Telegram reply -> resolved-marker -> auto-promote in one integration test so regressions in askOwnerSteps, blocked-promoter, owner-question-reply, or installAwaitResumers fail a single named test instead of slipping through unit-test seams.
created_at: 2026-04-25T04:43:34.328Z
updated_at: 2026-04-25T05:13:18.402Z
---

## Problem

The owner-decision unblock cycle is now load-bearing for any blocked task
whose precondition is `kind: owner-decision`: blocked-promoter calls
`askOwnerSteps` on a 14-day cadence; the recipe enqueues a question through
`OwnerQuestionQueue`, suspends the run on `owner.question.resolved`,
persists the suspension via `installAwaitResumers`, the operator answers
either through inline-keyboard buttons or a free-form Telegram chat reply
routed by `owner-question-reply`, and on the next blocked-promoter cycle
the task auto-promotes after a `<!-- blocked-promoter-resolved: ... -->`
marker is written. Each component has dedicated unit/integration tests
(`ask-owner-step.test.ts`, `blocked-promoter/workflow.test.ts`,
`telegram/owner-question-reply.test.ts`, `installAwaitResumers` coverage),
but no single test exercises the full cycle, including a daemon restart
mid-wait. A regression in the seam between any two components — for
example, a free-form chat reply that resolves the queue but does not
trigger the suspended workflow's resume, or a resolved marker written to
the task but missed by the next blocked-promoter cycle — would not surface
until the cycle silently breaks in production. The bus event names,
question-id wiring, frontmatter marker format, and resume serialization
are exactly the seams that drift quietly over time.

## Desired Outcome

One integration test under `src/` exercises the full owner-decision unblock
cycle against the real `blocked-promoter` workflow, the real
`OwnerQuestionQueue`, and the real `installAwaitResumers` resume path,
with the daemon stopped and restarted between the ask and the answer. The
test seeds a synthetic blocked task with `kind: owner-decision`, lets
blocked-promoter ask the operator, asserts the question lands in the queue
and the workflow run is suspended, simulates a daemon restart, delivers a
free-form chat reply through the same path Telegram uses, and then asserts
that on the next blocked-promoter cycle the task auto-promotes to `ready/`
with the resolved marker present. A regression in any of the four named
seams fails this single test, with a clear message that names the seam.

## Constraints

- Use the real `blocked-promoter` workflow definition, the real
  `askOwnerSteps` recipe, the real `OwnerQuestionQueue`, the real
  `installAwaitResumers` resume path, and the real `owner-question-reply`
  free-form-text path. No re-implementing the cycle inline.
- The test owns the scratch project root and the daemon lifecycle. No
  test-only production flags or hooks; the daemon must restart through
  its real lifecycle.
- Telegram's transport must be stubbed at the channel boundary, not at the
  owner-question-queue boundary. The free-form reply must enter through
  `owner-question-reply` exactly the way a real Telegram chat reply does.
- The synthetic blocked task must not pollute `data/tasks/`. Use a
  scratch project root under `os.tmpdir()` with its own `data/tasks/`
  layout so production task files are never touched.
- This is one integration test, not a parallel integration framework. Live
  next to the relevant code (autonomy module or `src/integration.test.ts`
  per the root-layout policy in `src/AGENTS.md`).
- The test's wall-clock cadence must not depend on the production 14-day
  re-ask cadence. Drive cadence inputs by injection at the workflow's
  decision boundary, not by sleeping or by faking system time globally.
- No mocking the bus event names; assert the test exercises the same
  events (`owner.question.asked`, `owner.question.resolved`,
  `awaited.outcome`-class events) the production cycle emits.

## Done When

- A single integration test exists that drives blocked-promoter through
  ask → daemon-restart → free-form Telegram chat reply → resolved-marker
  → auto-promote against a synthetic `kind: owner-decision` blocked task
  in a scratch project root.
- The test asserts: (a) the owner-question lands in the queue with the
  correct slot/question text from the precondition; (b) the workflow run
  is suspended on `owner.question.resolved`; (c) the suspension survives
  a real daemon stop/start; (d) the free-form chat-reply path resolves
  the queue entry via `owner-question-reply`; (e) the next
  blocked-promoter cycle writes a `blocked-promoter-resolved` marker and
  moves the task to `ready/` (or `backlog/` for `p3`).
- Removing or breaking any of the four named components (askOwnerSteps,
  blocked-promoter, owner-question-reply, installAwaitResumers) fails the
  test with a message that names the broken seam.
- The test runs in `pnpm test`, completes in under 60 seconds wall-clock,
  and leaves no scratch state behind.
- A sentence in `src/modules/autonomy/AGENTS.md` (or the
  `blocked-promoter/AGENTS.md`) names this integration test as the
  load-bearing regression for the owner-decision unblock cycle.

## Source / Intent

The askOwner-from-autonomy-workflows protocol, blocked-promoter
auto-promotion of satisfied preconditions, and free-form Telegram
chat-reply resolution all landed in close succession (commits
`06a3588d`, `c068b145`, `420e501e`, `fd1695d1`). Each component carries
its own tests, but the entire cycle the operator depends on — "the
autonomy loop asked me a decision; I answered freely on Telegram; the
blocked task moved" — is not exercised end-to-end. This task preserves
the cycle as a single named regression target before the seams drift
quietly.

## Initiative

Operator-in-the-loop reliability: the owner-decision unblock cycle is the
only path KOTA has for routing irreducibly-human decisions back into the
autonomous queue. The cycle must remain demonstrably restart-safe end-to-
end, not only piecewise.

## Acceptance Evidence

- The new integration test lives under `src/` (or `src/modules/autonomy/`)
  and runs in the default `pnpm test` invocation.
- Running the test on `main` passes; deleting any one of the four named
  components causes it to fail with a seam-naming message — captured as a
  short transcript in the run directory or PR description.
- The named pointer in `AGENTS.md` makes it discoverable for future agents
  triaging owner-decision regressions.
