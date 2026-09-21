---
status: open
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
