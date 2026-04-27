# Answer Module

Cited-answer seam on top of cross-store recall. One natural-language
query returns one short composed answer plus typed citations resolving
back to the underlying typed `RecallHit`s.

## What this module owns

- The `AnswerProvider` primitive and its single in-process implementation.
- The synthesizer prompt and the citation parser (`[source:id]` markers).
- One daemon-control route (`POST /answer`) plus its user-facing twin
  (`POST /api/answer`) — both share `createAnswerRouteHandler` so the
  wire shape cannot drift.
- One `KotaClient.answer` namespace and one `kota answer <query>` CLI
  subcommand rendered through `src/modules/rendering`.

## Typed citation contract

The synthesizer emits `[source:id]` markers in the prose where
`source ∈ {knowledge, memory, history, tasks}` (matching `RecallSource`
exactly; no aliases) and `id` is the typed hit id. The parser
extracts each marker, validates it against the typed `RecallHit[]` the
synthesizer was shown, and returns:

- `answer: string` — the prose verbatim, markers preserved inline so the
  operator sees attribution next to the supporting clause.
- `citations: AnswerCitation[]` — de-duplicated, in original order,
  capped at `ANSWER_MAX_CITATIONS`.
- `hits: RecallHit[]` — the strict subset of recall's hits referenced
  by `citations`, preserving recall's score ranking.

A marker that does not resolve against the hit pile is never silently
kept as a broken pointer. The seam retries the synthesis once with a
restricted-marker note; if the retry still fails to resolve every
marker (or returns no markers at all), the seam surfaces
`{ ok: false, reason: "synthesis_failed" }`.

## Degradation rules

- `recall` returns `ok: false, reason: "semantic_unavailable"` →
  forwarded verbatim.
- `recall` returns `ok: true, hits: []` →
  `{ ok: false, reason: "no_hits" }`.
- Synthesizer throws on the first call →
  `{ ok: false, reason: "synthesis_failed" }` (no retry — the throw is
  the operator-visible signal).
- Initial citations contain unknown markers → ONE retry with a
  restricted-marker reminder.
- Retry still fails (throw or unresolved markers or zero markers) →
  `{ ok: false, reason: "synthesis_failed" }`.

The seam therefore makes at most two model calls per `answer(query)` —
never silent fan-out beyond that.

## Boundaries

- No second retrieval path. The seam delegates to `RecallProvider` and
  reuses recall's typed hit shape verbatim — no parallel embedding
  cache, no parallel contributor registry.
- No public prompt-template knob. The synthesis prompt is internal and
  co-located in `synthesis-prompt.ts`. Tuning lands as a focused
  follow-up, not as a per-call parameter.
- No cost surfacing into autonomy. The module uses the project's
  configured model client; cost dashboards stay where they already
  live.
- No fan-out from this module. Surface adoption (Telegram, macOS,
  mobile, web) ships as honest single-task follow-ups, not a parallel
  five-surface chain seeded here.
