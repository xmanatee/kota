---
id: task-demo-askownersteps-in-a-real-autonomy-workflow-and
title: Demo askOwnerSteps in a real autonomy workflow and flip the AGENTS.md rule
status: done
priority: p1
area: autonomy
summary: Splice the askOwnerSteps recipe into one autonomy workflow that genuinely needs operator escalation, produce a real .kota/runs/ artifact of question -> answer -> resume, and flip src/modules/autonomy/AGENTS.md from 'No ask_owner from autonomous workflow steps' to the new step-pattern contract. Closes the notification-delivery umbrella's last two follow-ups.
created_at: 2026-04-25T02:11:41.178Z
updated_at: 2026-04-25T02:26:35.996Z
---

## Problem

The pausable `await-event` step primitive landed in 0254fe74, the
`askOwnerSteps` recipe replaced the in-tool held-await polling in
55072f5a, and the recipe ships with restart-during-wait + answered +
dismissed integration tests in `src/core/workflow/ask-owner-step.test.ts`.
Despite all of that infrastructure being in place, no autonomous
workflow actually composes the recipe today, and
`src/modules/autonomy/AGENTS.md` still tells autonomous steps the rule
is **forbidden**: "No `ask_owner` from autonomous workflow steps...
Re-enable only once the runtime has a restart-safe await-event step
and `ask_owner` uses it." That precondition is now true. Until a real
autonomy workflow uses the recipe and the rule flips to describe the
new contract, autonomous runs still have to reshape every operator
decision into a `blocked/` task — exactly the cost the umbrella
notification-delivery task identified as load-bearing waste.

## Desired Outcome

One real autonomy workflow uses `askOwnerSteps` to escalate a decision
that previously would have forced a `blocked` move, the run produces a
`.kota/runs/` artifact showing question → operator answer → workflow
resume → completion, and `src/modules/autonomy/AGENTS.md` documents
the re-enabled contract (budget bounds, the four typed terminal
outcomes from `AwaitedOwnerOutcome`, when to escalate vs when to
move to `blocked/`) instead of the old "forbidden" rule. The blocked
umbrella `task-land-notification-delivery-channel-so-autonomous-w`
either closes (if all of its `## Done When` items now hold) or
collapses to whatever residue genuinely remains.

## Constraints

- Use the existing `askOwnerSteps` recipe from
  `src/core/workflow/ask-owner-step.ts`. Do not introduce a parallel
  escalation primitive or hand-roll the three-step pattern in the
  consuming workflow.
- Pick exactly one consuming workflow for the demo. Decomposer is the
  umbrella's named candidate, but any autonomy workflow whose run
  legitimately needs an operator decision is acceptable. Document the
  choice and why it is the natural first consumer in the workflow's
  own `AGENTS.md` or local prompt, not in a separate doc.
- The escalation point must be a real conditional — the workflow only
  enters the recipe when its prior step output indicates an actual
  operator decision is needed (constraint conflict, scope ambiguity,
  external blocker). Wiring an unconditional `ask_owner` for the
  demo is a regression of the original cost concern.
- Honor the `AwaitedOwnerOutcome` discriminated union completely: the
  consuming workflow must handle `answered`, `dismissed`, `expired`,
  and `timeout` distinctly. `expired` and `timeout` should fall back
  to the existing `blocked/` reshape pattern; `dismissed` should also
  do so unless the dismiss reason explicitly authorizes a different
  resolution. Suspicious answers (`answered.suspicious === true`)
  must be handled through the recipe's pre-rendered banner so
  injection-defense applies.
- The autonomy/AGENTS.md rule flip must describe the contract, not
  just permission: budget defaults, terminal outcomes, when to
  escalate, and the requirement that the consuming workflow handle
  every `AwaitedOwnerOutcome` kind explicitly.
- No new module-level dependencies on `#core/tools/ask-owner.js` from
  inside an autonomy workflow — the workflow consumes the recipe, not
  the underlying tool.
- No backwards-compatibility dual path. The autonomy/AGENTS.md "No
  `ask_owner` from autonomous workflow steps" prose is replaced, not
  amended with an exception list.

## Done When

- One autonomy workflow's `workflow.ts` splices `askOwnerSteps` into
  its definition, gated by a real conditional, and consumes every
  `AwaitedOwnerOutcome` kind explicitly.
- A `.kota/runs/<run-id>/` artifact under this task's evidence shows
  the workflow opening a question, the operator queue resolving it
  with an answer, and the workflow finishing the work the answer
  unblocked. Restart-during-wait coverage already lives in
  `src/core/workflow/ask-owner-step.test.ts`; this task does not
  duplicate that fixture.
- A focused workflow-level test (not the recipe-level test) covers
  the conditional: when the prior step output indicates no
  escalation is needed, the recipe steps are skipped; when it does,
  they run and the `consume` output is propagated correctly.
- `src/modules/autonomy/AGENTS.md` no longer says "No `ask_owner`
  from autonomous workflow steps". It documents the new contract,
  including the four `AwaitedOwnerOutcome` kinds and the budget
  defaults.
- The blocked umbrella task
  `task-land-notification-delivery-channel-so-autonomous-w` is moved
  to `done/` (or its remaining `## Done When` items are honestly
  recaptured into a tighter follow-up if any actually remain).

## Source / Intent

This task is the second and third follow-up named in the
`## Blocker` section of
`task-land-notification-delivery-channel-so-autonomous-w`:

> 2. Flip the `src/modules/autonomy/AGENTS.md` rule from "forbidden"
>    to "allowed under the new step pattern", with explicit budget
>    bounds and the typed `operator-unreachable` terminal.
> 3. Add the real-autonomy-workflow demo + the three-outcome
>    integration tests against the wired channels.

Step 1 of that plan ("Replace the in-tool `ask_owner` polling with
the new step-shaped pattern") landed in 55072f5a (`Convert ask_owner
from held-await polling to step-pattern recipe`). The recipe-level
three-outcome integration test cited by step 3 already lives in
`src/core/workflow/ask-owner-step.test.ts` (answered, dismissed,
restart-during-wait), so this task collapses the umbrella's
remaining two follow-ups into a single coherent change: flip the
rule, ship the first real consumer, close the umbrella.

The original umbrella was created because every recorded autonomous
`ask_owner` call was expiring unanswered and burning ~$X of vendor
credit plus 10 minutes of wall-clock per incident, and because work
that a two-sentence operator answer could unblock was instead
stalling in `blocked/` for days. With the recipe in place, the
remaining cost is purely conventional: autonomous workflows still
cannot use the new path until the rule says they can and one real
workflow demonstrates the contract.

## Initiative

Recoverable operator loop — autonomous workflows escalate one-line
decisions through the same queue and notification primitives clients
already use, with explicit budget bounds and typed terminal outcomes,
without re-introducing the recorded-and-expired waste that originally
forced the ban.

## Acceptance Evidence

- The `.kota/runs/<run-id>/` directory of the chosen workflow's
  successful demo run, showing `owner.question.asked` →
  `owner.question.resolved` (answered) → workflow completion with
  the work the answer unblocked. Link the run id in the commit
  message.
- The diff of `src/modules/autonomy/AGENTS.md` showing the rule
  flip from "No `ask_owner` from autonomous workflow steps" to the
  new contract.
- The diff of the consuming workflow's `workflow.ts` showing the
  `askOwnerSteps` splice and the explicit handling of every
  `AwaitedOwnerOutcome` kind.
- The new workflow-level test exercising the escalation conditional.
- `pnpm test` green on the smoke gate, including
  `src/core/workflow/ask-owner-step.test.ts`.
