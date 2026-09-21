---
status: blocked
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

## Investigation Findings

September 21, 2026, builder run `2026-09-21T04-20-17-880Z-builder-ij70a7`,
source revision `856b687bd774af2380bdfef5d50811e1d152085c`.

The supported paths differ by client. Source review found:

- Web `clients/web/src/components/chat/ChatArea.tsx` allows composing a draft
  during streaming, but disables Send and ignores submission while `sending`.
  `clients/web/src/api/client-chat.ts` has no cancel operation. Thus a draft
  correction is not an accepted correction; it must be submitted after the
  stream ends. This is source evidence, not a rendered observation.
- Apple `clients/apple/Sources/KotaShared/ChatView.swift` disables the text
  field and Send while streaming. React Native
  `clients/mobile/src/screens/ChatDetailScreen.tsx` gates Send while streaming;
  its Close action deletes the session. Neither inspected view offers the
  daemon's cancel-without-closing action. Closing is not equivalent to
  cancel-then-correct in the same live session.
- ACP's `src/modules/agent-client-protocol/server.ts` handles `session/cancel`
  and emits a cancelled stop reason; `daemon-adapter.ts` calls the daemon
  cancellation route. A2A's `src/modules/a2a-channel/daemon-session-client.ts`
  also calls that route for `tasks/cancel`. These maintained adapters prevent
  generalizing the graphical-client limitation to all KOTA clients.

The daemon owns acceptance and settlement. In
`src/core/daemon/daemon-control-session-routes.ts`, cancellation returns 204
after requesting abort, without awaiting the active send. In
`daemon-chat-handlers.ts`, a new message is rejected with 409 while `busy`,
and `busy` clears in the prior send's `finally` block. Cancellation acceptance,
old-turn settlement, and acceptance of the correction are separate events.
The correction can affect model work only after a subsequent send is accepted;
204 alone does not establish this. Whether a client clearly exposes this
interval remains an observation question.

`src/core/loop/loop.ts` aborts active controllers without replacing the session.
`loop-send.ts` checkpoints completed tool results and history during execution.
Neither fact establishes rollback, preservation of every in-flight result, or
successful reuse of unrelated work by the next model turn.

Fresh limited checks:

- `pnpm test:owner src/core/daemon/daemon-chat-pool.test.ts`: 12 passed,
  including cancellation retaining the session with a mocked agent. This
  distinguishes pool deletion from turn cancellation, not model correctness.
- `pnpm test:protocol src/modules/agent-client-protocol/index.test.ts -t
  'cancels an active prompt and returns the cancelled stop reason'`: one passed,
  33 unselected. This checks the ACP cancellation projection against a fake
  daemon, not the composed daemon/model journey.
- `pnpm test:integration src/core/daemon/daemon-chat.integration.test.ts`:
  14 failed at local listener setup (`listen EPERM`, `127.0.0.1`), with one
  associated unhandled rejection. No HTTP behavior is claimed from that run.

The supplied issue evidence contains an unrelated historical research-source
capture, not an active-correction journey. The archived continuity task proves
an aggregate visibility surface, not this interaction. The three research
sources above were readable again; their control and timing distinctions
remain useful, but add no local product evidence.

Disposition: investigation incomplete. The graphical-client source gap is a
candidate for the client/session owners to verify; no rendered client failure,
corrected final report, preservation result, or general adequacy conclusion was
established. No implementation task, new runner, fixture, or steering mechanism
was created. This task continues to own the question; the adjacent correction-
reuse and optional-assistance investigations remain separate.

## Source reassessment — September 21, 2026

Collector run `2026-09-21T04-31-33-890Z-research-source-collection-9iehdl`
called `web_fetch` for all three sources at 04:32:38–39 UTC and reported each
readable. Retry run `research-retry-child-2fba788a69a3abba83159eeb` assessed
those supplied readings; no additional source calls or client probes ran.

- [InterruptBench](https://arxiv.org/html/2604.00892v1): the supplied text
  reaches partway through section 2.3 before truncation at 12,000 characters.
  Its addition/revision/retraction cases and requirement that each update
  change the correct answer support assessing the final report against the
  revised request. Progress-relative replay supports varying correction timing
  in a future comparison. Later methods and results were not freshly read;
  the earlier section 3 notes above remain prior evidence.
- [Multi-interrupt guide](https://github.com/HenryPengZou/InterruptBench/blob/main/Eval/interrupt_config/MULTI_INTERRUPT.md):
  the supplied guide describes successive replay rounds, ordered updates and
  accumulated intent, with later interruptions placed midway through the
  remaining action segment. This supports checking that later corrections
  preserve still-applicable requirements. It does not establish live KOTA
  cancellation, rollback or retention of useful work.
- [AgentGUI](https://arxiv.org/html/2607.26300v2): section 3.3 distinguishes
  direct intervention during a turn from task edits reviewed after that turn,
  supporting the task's separate acceptance, settlement and effect observations.
  The supplied text truncates during section 4.1 at 12,000 characters, so the
  full evaluation was not assessed. Its role-marker screening annotation was
  retained as an untrusted-content warning; source text was treated only as
  research evidence.

Disposition: retain `blocked`. Source access is available, but none of these
readings supplies the attributable supported-client journey or host-authorized
execution profile required below. The report's corrected range and preservation
of unrelated work remain unobserved. Existing local findings and environment
limitations were not rechecked in this retry; no product adequacy or new defect
is established.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: An attributable supported-client cancel-then-correct observation with final report and retained-work evidence, or an applicable host-authorized contained execution profile to collect it.

The path is a discovery hint, not a required capture directory.

The authorized native surface was queried with
`pnpm kota eval contained '{"operation":"inspect"}'`. The host returned
`is_error: true` and `Set KOTA_EVAL_CONTAINED_PROFILES in the trusted host environment`.
No configured profile is exposed through that surface. Worker requests cannot
configure host access. This does not imply absent host credentials, models,
Docker, or client installations.

Local alternatives also could not produce the missing observation: Playwright
could not find its Chromium executable; web React/jsdom dependencies were not
resolvable; the frozen dependency install encountered registry `EPERM` and was
stopped; the HTTP check could not bind a listener. These are sandbox execution
limitations, not failures of KOTA's correction behavior. No screenshot or
rendered transcript was fabricated from source or mocked output.

Resume through an applicable host-selected contained capability or an equivalent
attributable export of an actual supported-client journey. Record the client
and source revision, model/provider, session identity, tools/isolation, initial
request, correction, abort acknowledgement, old-turn settlement and next-turn
acceptance. For a local report, change September 1–7 to September 8–14 after
unrelated useful work exists; inspect the final included records/totals and
before/after evidence for that unrelated work. Check both removal of the old
range and inclusion of the new range; distinguish an unchanged file from
unnecessary recomputation using the available execution record. A client that
cannot reach cancellation should have that failure rendered and attributed
before proposing a deduplicated follow-up. Do not treat a close/delete action
as preserved-session cancellation.

A single observation can establish the local outcome; no comparison is yet
required. If comparing later, an upfront final-request control tests the cost
of changing intent, while withholding the correction tests response to missing
information. Neither a model's self-report nor mocked transport proves success.

Detailed collection results are retained in this run's
`agent/active-correction-investigation.md`. Only this task's state and findings
are retained repository changes; production behavior is unchanged.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-21T04:31:06.086Z -->

<!-- research-retry-attempt: {"fingerprint":"994fa040f328d3cd","attemptedAt":"2026-09-21T04:32:39.150Z","attempts":[{"url":"https://arxiv.org/html/2604.00892v1","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T04:32:38.717Z","tools":["web_fetch"],"outcome":"readable"},{"url":"https://github.com/HenryPengZou/InterruptBench/blob/main/Eval/interrupt_config/MULTI_INTERRUPT.md","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T04:32:39.121Z","tools":["web_fetch"],"outcome":"readable"},{"url":"https://arxiv.org/html/2607.26300v2","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T04:32:39.150Z","tools":["web_fetch"],"outcome":"readable"}]} -->
