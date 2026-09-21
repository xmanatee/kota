---
status: blocked
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

## Investigation — September 21, 2026

Builder run `2026-09-21T14-34-28-503Z-builder-gm45bw` inspected source HEAD
`49c1723f71ae256dc1c4474b473278bd73abca90`. Maintained Google integration
coverage establishes token ownership, inbound body propagation, reply approval
and calendar recovery. The cross-store conversational journey uses scripted
model responses; no inspected fixture or supplied retained evidence establishes
the matched Gmail/Calendar answer distinction. The related relative-date task
also explicitly lacks final model answers. This is a bounded search, not a
claim about every historical conversation.

The production listing owner preserves complete/partial/unavailable state.
Service adapters render it into tool content and `is_error`; the conversation
context forwards both to the model. Setup guidance is a separate discovery path:
Workspace declares OAuth requirements, and resource discovery exposes
`kota setup list --json` and the applicable
`kota setup start google-workspace oauth-credentials` route. The list error
itself includes no setup route. A service 403 does not establish a particular
credential failure; missing config can instead remove the entire tool set.

Four deterministic production-tool calls compared Gmail unavailable (403) plus
Calendar complete-empty against both complete-empty, with a fixed September 22,
2026 UTC window, invented credentials and a controlled HTTP port. The available
Calendar result survived; unavailable Gmail did not become “No messages found.”
All 95 existing tests in `gmail.test.ts`, `calendar.test.ts` and `listing.test.ts`
passed. These establish adapter behavior, not model selection or answer meaning.

Retained evidence is under this run's artifact directory, `source-availability/`:
`findings.md`, `adapter-probe.mjs`, `adapter-observations.json`, and command
captures with argv, timestamps, exit codes and stream hashes. The observations
retain source hashes, request/window, source states, tool definitions, authored
arguments, provider payloads and exact returned results. Model-visible results
and final answers are explicitly absent. The probe's initial ISO-format-only
assertion failure and corrected passing run are both retained.

Disposition: keep this as an unresolved research question. No model observation
supports either a no-change conclusion or an implementation follow-up. No
production source, prompt, connector, readiness store or permanent fixture changed.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: An authorized model-backed KOTA matched source-availability observation, or equivalent attributable session, tool-result and final-answer evidence.

The path is a discovery hint, not a required capture location. A fresh authorized
`pnpm kota eval contained '{"operation":"inspect"}'` reached the host and
returned `is_error`, exit 1, explicitly requiring `KOTA_EVAL_CONTAINED_PROFILES`
in the trusted host environment. The original stdout capture was hidden by the
review artifact policy, so post-check repair repeated the writer inspection at
2026-09-21T14:41:47Z–14:41:50Z, obtaining the same diagnostic with tool use
`tool-744ccbfb844b627d63c9177775371047`.

`source-availability/host-inspect-diagnostic.json` retains that exact public
setup diagnostic, invocation id, request, timestamps, exit status and SHA-256
of the captured stream. Extraction verifies the known public diagnostic and
includes no profile values or provider data. `verify-diagnostic-projection.mjs`
checks its equality to the captured response and confirms these fields survive
the production agent-context projection, including filename classification;
`diagnostic-review-projection.json` retains the passing projection. Original
streams and execution metadata remain in the `host-inspect-repair` captures.
Worker requests cannot configure the host grant. The critic's separate native
writer authorization denial does not establish host configuration; the writer's
successful inspection transport supplies the setup diagnostic. Neither result
establishes that provider credentials are absent.

Resume when an authorized scoped model observation can use the existing tools
with controlled HTTP responses under the required isolation/auth/egress, or when
equivalent attributable evidence becomes available. Keep request, window, model,
instructions and tool policy comparable; retain actual model-selected arguments,
visible results, final answers and effects. The prepared paired request and
judgment criteria are in `source-availability/findings.md`. Verify disclosure of
missing mail coverage, preservation of the empty Calendar result, appropriately
scoped empty conclusions and existing setup guidance without collecting secrets
in chat. Do not prescribe call order or treat deterministic checks as answers.
The original consumer acceptance remains unmet; safe retained changes are this
task disposition and run evidence only.
