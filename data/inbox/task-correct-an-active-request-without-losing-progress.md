# Correct an active request without losing useful progress

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
