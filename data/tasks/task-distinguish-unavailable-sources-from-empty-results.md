---
status: open
priority: p3
---

# Can a cross-service answer distinguish unavailable sources from empty results?

Research lead from explorer run `2026-09-21T13-58-22-900Z-explorer-jzbp00`;
sources read online September 21, 2026.

[PAUSE, Appendix A.1](https://arxiv.org/html/2607.27354v1)
models data availability as dependent on source connections, permissions and
requested time ranges. Feature probes expose restricted states. Its section 5.2
reports gains from explicit configuration guidance. Section 7 acknowledges
incomplete state verification for open-ended tasks and no systematic pass@k or
pass^k reporting. The [released repository](https://github.com/hyc481/PAUSE)
also reports model-performance variation with unresolved causes. These are
external observations, not evidence of a KOTA defect or a prompt recommendation.

KOTA already owns setup/reauthorization through the module setup protocol.
`src/modules/google-workspace/capability-readiness.ts` probes OAuth token
refresh, while `listing.ts` and service adapters distinguish complete,
incomplete and unavailable retrieval. The useful unresolved question is how
an assistant combines those states across sources in its answer.

Consider a request to summarize relevant mail and calendar commitments. If one
source is unavailable while the other returns a complete empty result, can the
assistant preserve the useful result, name the missing coverage, and describe
the existing setup route without claiming there are no commitments or asking
for credentials in chat? Compare that with both sources being available and
empty. First inspect existing conversational coverage; pursue a matched
consumer observation only if this distinction is not already established.
Judge answer meaning and authorized effects, not reference tool-call order.

This differs from the active relative-date retrieval investigation (query
bounds and local-day meaning), completed pagination fixes, and the archived
setup/auth protocol task. No new connector, readiness store, health integration,
benchmark runner or implementation task is proposed. A credible observation
could settle this with no change; retain this as a research question until then.

## Research Outcome And Acceptance

Determine whether the existing conversational journey distinguishes missing
source coverage from a complete empty result. No urgency was stated; p3 reflects
exploratory work. This is not a confirmed defect or an implementation mandate.

- Inspect maintained conversational coverage and retained consumer evidence
  first. Trace how actual mail/calendar results and setup guidance reach the
  assistant; readiness and adapter tests alone do not establish answer meaning.
- If the distinction remains unestablished, assess and pursue a small authorized
  matched observation: one unavailable source plus one complete empty source,
  compared with both sources complete and empty. Keep the request, time window,
  model and relevant instructions comparable. Use invented records and read-only
  requests; distinguish controlled-provider evidence from live Google behavior.
- Retain the request, source states, actual tool results visible to the model,
  final answer and execution provenance. Judge whether the answer preserves the
  available result, names missing coverage, avoids an unsupported global claim
  of no commitments, and describes the applicable existing setup route without
  requesting credentials in chat. Do not prescribe reference tool-call order.
- Record a grounded disposition: existing evidence suffices, the observation
  supports no change with stated limits, or an observed failure warrants a
  bounded follow-up for its existing owner. If observation cannot proceed,
  retain completed findings and identify the specific unavailable prerequisite.
  No new connector, readiness store, health integration, benchmark runner or
  permanent fixture is required by this task.

## Triage Provenance

Normalized from `data/inbox/task-distinguish-unavailable-sources-from-empty-results.md`
on September 21, 2026. The original research question and explorer provenance
above are preserved. The cited PAUSE paper and repository were readable during
triage; Appendix A.1, sections 5.2 and 7, and the README's reproduction notes
support the source distinctions recorded above. Neither external code nor its
benchmark was executed; these claims do not establish KOTA behavior.

Active-task inspection found no owner for this cross-source answer question.
`task-investigate-relative-date-retrieval-and-answer-meaning` owns query bounds
and local-day interpretation, with a separate observation prerequisite; it is
not a hard predecessor. Existing setup/auth and pagination work remains with
its current owners.

Limited source inspection found `listing.ts` preserves complete, partial and
unavailable states; `listing.test.ts` covers failed continuation after an empty
page. Gmail and Calendar owner tests cover complete empty results, and
`capability-readiness.test.ts` covers missing OAuth secrets and refresh failure.
These checks were inspected, not rerun. The bounded integration/fixture search
surfaced token ownership, inbound mail, reply and calendar recovery coverage,
but did not establish the paired conversational outcome. Further coverage and
consumption-path investigation remains useful, so the task starts open. No
model observation or execution-readiness probe ran during triage.
