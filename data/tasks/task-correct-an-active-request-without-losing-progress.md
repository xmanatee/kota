---
status: open
priority: p3
---
# Investigate correcting an active request without losing useful progress

Explorer research lead, September 21, 2026. No KOTA defect or adoption decision
is established.

[InterruptBench](https://arxiv.org/html/2604.00892v1), sections 2–3 read online,
separates adding, revising and retracting requirements during execution, then
scores the final updated intent. Its no-update reference retains the transformed
initial request; it is not a control given the complete final request upfront.
The [multi-interrupt guide](https://github.com/HenryPengZou/InterruptBench/blob/main/Eval/interrupt_config/MULTI_INTERRUPT.md)
implements successive stages by replaying earlier actions and accumulating
updates. This informs comparison design, not live cancellation or rollback
guarantees. Neither the external benchmark nor a KOTA comparison ran here.

[AgentGUI](https://arxiv.org/html/2607.26300v2), section 3.3 read online,
distinguishes direct intervention in the current turn from task-definition
edits reviewed after that turn. That distinction suggests making the effective
timing of a correction clear to the operator; its reported UI/model results do
not establish a benefit for KOTA.

Current local context: `handleDaemonChat` in
`src/core/daemon/daemon-chat-handlers.ts` rejects a message while the session is
busy. The same owner exposes cancellation without closing the session.
`src/core/daemon/daemon-chat.integration.test.ts` covers cancellation followed
by another chat using a mocked agent. This is transport/lifecycle coverage,
not proof that a real assistant incorporates the correction or preserves useful
partial work. These are source observations, not fresh test results.

Open question: is cancel-then-correct already an adequate operator journey?
For example, while preparing a local report, the user changes its date range.
Investigate whether the operator can tell when the change takes effect and
whether the completed report uses the new range without discarding unrelated
completed work. Inspect the actual supported client journey and existing
evidence first. If a comparison is warranted, distinguish message acceptance,
turn settlement, retained work and final-intent fulfillment; an upfront
final-request control answers a different question from withholding the update.

This concerns a user's correction to active work, distinct from the active
cross-session correction-reuse and optional-suggestion investigations. The
archived continuity-surface task already owns aggregated work visibility.
Existing session, client and evaluation owners should determine whether any
follow-up is justified; this lead does not request a new queue, runner, fixture,
automatic steering manager or imported benchmark.

## Research Outcome And Acceptance

Determine whether the supported cancel-then-correct journey adequately handles
a user's change to active work, starting with existing client behavior and
retained evidence. Preserve the capture's question, "Correct an active request
without losing useful progress", as an investigation rather than a confirmed
implementation need. No urgency was stated; this is p3 exploratory work.

- Identify the maintained client/session owners and inspect an actual supported
  journey through a rendered transcript, screenshot or equivalent evidence.
  Separate when the correction is accepted, when the prior turn settles, and
  when the assistant acts on the updated request.
- If existing evidence is insufficient, use a contained local report example
  to observe the corrected date range in the final result and preservation of
  unrelated useful work. Attribute client, model and execution conditions;
  distinguish observed behavior from source review and mocked coverage. Any
  comparison must state its control and which question that control answers.
- Record an evidence-grounded disposition: existing behavior suffices, no
  demonstrated gap, or a concrete deduplicated follow-up for the failing owner.
  If necessary observation is unavailable, name the specific external
  prerequisite and retain completed investigation under the task contract.

The related active tasks `task-investigate-correction-reuse-in-later-assistance`
and `task-investigate-optional-assistance-interruption-value` answer different
questions and are not hard predecessors. Archived
`task-improve-long-running-work-continuity-surfaces` covers aggregated visibility.

## Triage Provenance

Normalized from `data/inbox/task-correct-an-active-request-without-losing-progress.md`
on September 21, 2026. All three source URLs above were readable during triage;
InterruptBench sections 2–3, the multi-interrupt guide's staged replay design,
and AgentGUI section 3.3 support the distinctions recorded here. The local busy
rejection, cancellation route and mocked follow-up test were also inspected.
No KOTA journey, model comparison, external benchmark or behavioral test ran
during triage. Source accessibility does not establish product adequacy.
