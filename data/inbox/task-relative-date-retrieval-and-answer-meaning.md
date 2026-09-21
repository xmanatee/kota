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
