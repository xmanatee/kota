---
status: blocked
priority: p3
---

# Does “last week” select and describe the right records?

Research lead from explorer run `2026-09-21T11-08-19-626Z-explorer-3bjoau`,
sources read online September 21, 2026.

[Andrew Brook's agent-time-bench](https://github.com/AndyFooBlah/agent-time-bench)
separately measures time-bearing tool arguments and timestamps rendered in the
answer. Its [design](https://github.com/AndyFooBlah/agent-time-bench/blob/main/docs/design.md)
pins the clock, user zone and locale, then makes mock retrieval depend on the
submitted bounds. The useful question for KOTA is whether a correct-looking
answer hides records excluded by an incorrectly translated date range.

There is a concrete provider wrinkle: Google's
[Gmail filtering guide](https://developers.google.com/workspace/gmail/api/guides/filtering)
says date strings in search queries use midnight PST and recommends epoch
seconds for accurate bounds in other zones. KOTA's
`src/modules/google-workspace/gmail.ts` passes the agent's query through as `q`;
`calendar.ts` accepts ISO time bounds, with the lower bound applying to event
end time. A generic half-open timestamp-filter mock does not establish correct
behavior for both APIs. This is a plausible relevance argument, not an observed
wrong KOTA answer.

Open question: with an explicit user zone and reference time, can KOTA answer a
read-only request about last week's mail or agenda while selecting the intended
records and describing boundary timestamps in the user's local day? If two
reasonable interpretations select different records, does it disclose the
assumption or obtain the missing intent?

Before proposing a parser, dependency or prompt change, investigate a small
matched consumer journey using the existing tools and independently derived
boundary records. Distinguish query selection, provider interval semantics and
final answer accuracy; include a case where an interpretation changes the
answer. The benchmark's
[ground-truth policy](https://github.com/AndyFooBlah/agent-time-bench/blob/main/docs/ground-truth.md)
deliberately makes admissible ambiguous readings select the same rows, so it
cannot answer that last question. Its design also states that the current
English-only corpus does not measure DST-transition days. The
[author's account](https://andrewbrook.dev/writing/agents-and-time/)
discloses limited personal review of the generated benchmark/library; reported
gains are external claims, not KOTA evidence or grounds for adopting `nl2time`.

Related completed work fixes reminder-input rejection, cron DST progress,
calendar pagination and calendar scheduling metadata. Those outcomes do not
measure natural-language retrieval intent and answer rendering. No duplicate
lead was found in active tasks, inbox or related archive searches. Keep this as
an unresolved lead until consumer evidence can support a bounded outcome;
neither a new evaluation runner nor another scheduler is proposed.

## Investigation Outcome And Acceptance

Establish whether KOTA's existing read-only mail and agenda journeys preserve
relative-date intent through retrieval and the final answer. This task resolves
the lead with consumer evidence; it does not assume a defect or authorize a
speculative time library, parser, scheduler, or evaluation runner.

- Inspect existing coverage and run a small matched journey through the existing
  tools with an explicit reference instant, user timezone, and week convention.
  Derive expected bounds and boundary records independently of any proposed
  treatment. Include local-midnight records that differ from their UTC day and
  an event crossing the calendar window boundary.
- Exercise provider-specific selection: Gmail query bounds and Calendar event
  overlap must follow their respective API contracts. A controlled external
  HTTP port is acceptable; fixed tool replies that ignore submitted bounds are
  not evidence of correct selection. Distinguish controlled-provider evidence
  from live Google observations.
- Include a meaningfully ambiguous request for which reasonable interpretations
  select different records. Inspect whether the answer discloses its assumption
  or seeks missing intent instead of silently treating one reading as certain.
- Retain the request, context, actual tool arguments, selected record identities,
  and rendered answer. Judge selection, provider semantics, and local timestamp
  rendering separately; a plausible answer alone does not establish retrieval
  correctness. Report any untested DST behavior explicitly.
- Close with a grounded disposition: no change with evidence and limitations,
  or a bounded follow-up describing an observed failure and its consumer outcome.
  If model or provider access prevents the consumer observation, retain useful
  local findings and identify the exact unavailable prerequisite; deterministic
  adapter checks alone do not prove model-dependent answer quality.

## Triage Provenance

Promoted from `data/inbox/task-relative-date-retrieval-and-answer-meaning.md`
on September 21, 2026. The original lead above, including its caution to keep
implementation unresolved, is preserved. The actionable outcome is investigation
and disposition, not adoption of the benchmark's proposed treatment. No urgency
was asserted; `p3` reflects exploratory work without an observed KOTA failure.
No overlapping active task was found. Related archived time, reminder, and
calendar work does not settle this natural-language consumer question.

The linked benchmark design, ground-truth policy, Gmail filtering guide, and
author account were readable and rechecked during triage on September 21, 2026.
Local inspection confirmed that `gmail.ts` forwards query text as `q` and
`calendar.ts` exposes the event-end lower bound. No KOTA consumer journey was
run during triage and no benchmark performance claim was independently verified.

## Investigation Evidence — September 21, 2026

Builder run `2026-09-21T11-46-51-381Z-builder-47efw9` inspected the production
Google Workspace tools and existing coverage. Its retained artifacts under
`relative-date/` contain `findings.md`, `oracle.json`, `probe.mjs`, and
`adapter-observations.json`. The source cohort is HEAD
`cafa1f1eaa0027a92a7f48b98e8abebbb1274694`, with measured adapter hashes in the
observations. No production code, prompt, dependency or evaluation runner changed.

With reference instant 2026-09-23T03:00:00Z, Asia/Tokyo, en-GB and an explicit
Monday week, the independent oracle gives September 14–20 local, bounded by
September 13 15:00Z and September 20 15:00Z. Nine deterministic calls through the
existing tools and a bounds-sensitive external HTTP double passed. Gmail epoch
bounds select the intended boundary records; PST date strings and UTC-midnight
bounds select different records. Calendar overlap includes events crossing either
edge and excludes events ending exactly at the lower or starting at the upper
bound. Sunday-week and rolling-seven-day interpretations also select different
records, so the ambiguity case is consequential. These are authored inputs and
controlled-provider observations, not observed model choices or live Google data.
The unchanged Gmail and Calendar owner suites passed all 55 tests in two files.

The artifacts preserve requests/context, authored arguments, outbound URLs,
selected identities and tool-rendered UTC timestamps. Final model answers are
explicitly absent. Selection by the model, local answer rendering and ambiguity
disclosure remain unverified; DST transitions, Gmail exact-bound equality and
sender-Date/receipt-time divergence were not tested. This evidence establishes a
useful discriminating cohort, not completion or an observed KOTA answer defect.

## Source Reassessment — September 21, 2026

Collector run `2026-09-21T12-00-06-955Z-research-source-collection-k5su2g`
returned readable `web_fetch` text for all five linked sources, with attempts
from 12:02:27.811Z through 12:02:29.259Z. Research-retry child
`research-retry-child-4342669d256305c88c96fbf2` assessed those supplied readings;
it made no additional source calls. The task matched the collection handoff
digest before editing.

- The [repository overview](https://github.com/AndyFooBlah/agent-time-bench)
  describes separate retrieval-bound and answer-rendering measurements across
  100 mocked scenarios. This supports judging both surfaces in the investigation,
  but its reported model gains do not measure KOTA. No published run data or
  benchmark code was independently inspected here.
- The [design](https://github.com/AndyFooBlah/agent-time-bench/blob/main/docs/design.md)
  pins reference time, zone and locale and grades submitted bounds separately
  from final text. Its mock half-open interval contract does not establish Gmail
  query semantics or Calendar overlap behavior. It explicitly lacks DST-transition
  coverage, so the task's untested DST limitation remains.
- The [Gmail guide](https://developers.google.com/workspace/gmail/api/guides/filtering)
  confirms date filtering through `q` on message/thread listing, with an
  `after:2014/01/01 before:2014/02/01` example. It also distinguishes API behavior
  from UI alias expansion and thread-wide search. This collected excerpt contains
  no PST-midnight or epoch-seconds guidance: the earlier research claim above is
  preserved as prior provenance, not freshly corroborated by this reading. It
  supplies no live boundary observation or exact-bound equality evidence.
- The [ground-truth policy](https://github.com/AndyFooBlah/agent-time-bench/blob/main/docs/ground-truth.md)
  separates timezone facts, calendar conventions and conversational policy. It
  describes hand-derived expectations, independent timezone checks and blind
  audits, while deliberately keeping admissible ambiguous readings answer-invariant.
  That design cannot settle this task's case where interpretations change the
  selected records; independent expectations and a consequential ambiguity case
  remain necessary. The claimed audit chain was read, not independently executed.
- The [author account](https://andrewbrook.dev/writing/agents-and-time/)
  reports tool-adoption lapses and answers mixing correct local weekdays with
  incorrect UTC-derived dates. These motivate inspecting complete answers but
  establish no KOTA defect. The author discloses limited personal review; regex
  grading and English-only scenarios further limit transfer. The account says
  all eight library bugs were fixed, whereas the repository overview says seven
  of eight with issue #23 still open. This unresolved source discrepancy prevents
  treating either summary as verified library correctness or an adoption basis.

Disposition: retain `blocked` on the same operator-controlled consumer-evidence
prerequisite below. Source access succeeded, but no new model session, actual
model-selected arguments, selected records or final answers were supplied.
The host evaluation setup was not rechecked in this retry. Existing adapter
findings and the previously captured host diagnostic remain prior evidence;
completion, promotion and a speculative implementation follow-up are unsupported.
The original inbox lead has already been promoted and is absent from the inbox;
no inbox status was changed.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: An authorized model-backed KOTA relative-date retrieval observation, or equivalent attributable session, tool and answer evidence.

The path is an evidence-discovery hint, not a required capture location.

An authorized model-backed KOTA consumer observation with these existing tools,
using the controlled Google HTTP port (or equivalent attributable scoped evidence).
The authorized `pnpm kota eval contained '{"operation":"inspect"}'` call reached
the host service and returned `is_error`, exit 1, explicitly requiring
`KOTA_EVAL_CONTAINED_PROFILES` in the trusted host environment. Tool-use identity:
`tool-adb7ddaabbce55bd894168bd2349f387`. This is a missing host grant/setup
prerequisite, not a claim of absent provider credentials from sandbox denial.
Worker requests cannot configure that host access.

Post-check repair retained a fresh direct command capture, rather than relying on
this narrative: `relative-date/host-inspect.stdout.txt` and
`host-inspect.stderr.txt` preserve the subprocess streams;
`host-inspect-execution.json` records argv, workspace, UTC execution times, exit
status and stream hashes. `host-inspect-result.json` extracts the exact host tool
result from stdout. The fresh call returned the same missing-profile diagnostic,
with tool-use identity `tool-51eb8766a59743cfc48769cb50687689`.
These are under this run's retained artifact directory. The critic's separate
writer-authorization denial does not establish host configuration; this writer's
successful inspection transport returned the explicit setup error.

Resume when the host supplies a scoped model evaluation profile with a supported
consumer scenario, container/auth/egress readiness, or an equivalent authorized
KOTA session transcript retaining model provenance, actual tool arguments, selected
records and answers. Reuse the prepared explicit and consequentially ambiguous
requests; judge date selection, provider semantics, local timestamp rendering and
assumption disclosure independently. Deterministic adapter checks cannot substitute
for this missing observation. No speculative treatment or failure follow-up is
justified yet. Safe retained changes are limited to this task disposition and run
artifacts; the original acceptance remains unmet.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-21T11:59:42.529Z -->

<!-- research-retry-attempt: {"fingerprint":"bccf78be96f73ded","attemptedAt":"2026-09-21T12:02:29.259Z","attempts":[{"url":"https://github.com/AndyFooBlah/agent-time-bench","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T12:02:27.811Z","tools":["web_fetch"],"outcome":"readable"},{"url":"https://github.com/AndyFooBlah/agent-time-bench/blob/main/docs/design.md","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T12:02:28.180Z","tools":["web_fetch"],"outcome":"readable"},{"url":"https://developers.google.com/workspace/gmail/api/guides/filtering","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T12:02:28.817Z","tools":["web_fetch"],"outcome":"readable"},{"url":"https://github.com/AndyFooBlah/agent-time-bench/blob/main/docs/ground-truth.md","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T12:02:29.229Z","tools":["web_fetch"],"outcome":"readable"},{"url":"https://andrewbrook.dev/writing/agents-and-time/","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T12:02:29.259Z","tools":["web_fetch"],"outcome":"readable"}]} -->
