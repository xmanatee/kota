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

## Persisted answer history

Every `AnswerProvider.answer(query, filter?)` call appends one typed
record to `<projectStateRoot>/answer-history/<id>.json` through the
module-owned `AnswerHistoryStore`. The store is the single record-
keeping path for cited-answer envelopes and the corpus seam the
eval-harness pulls real-failure provenance from. Reads are exposed as
`KotaClient.answer.log(filter?)` / `show(id)`, the
`kota answer log` / `kota answer show <id>` CLI subcommands, and the
`GET /api/answers` + `GET /api/answers/:id` HTTP routes (with the
`/answers` daemon-control twins).

Contracts:

- One record per call regardless of the discriminated `AnswerResult`
  arm. Success records carry the typed `RecallHit[]` the synthesizer
  was shown plus the typed `[source:id]` citations. Failure records
  carry the recall hits the seam saw (or an empty array for the arms
  that never reached recall).
- An append failure never alters the operator-visible response. The
  `onPersistError` callback surfaces the error through the module's
  warn channel and the answer envelope is still returned exactly as
  it was computed.
- Retention is module-internal: the store prunes oldest entries past
  `ANSWER_HISTORY_DEFAULT_CAP` on append. Pruning is best-effort and
  has no operator-facing knob.

## Boundaries

- No second retrieval path. The seam delegates to `RecallProvider` and
  reuses recall's typed hit shape verbatim — no parallel embedding
  cache, no parallel contributor registry.
- No public prompt-template knob. The synthesis prompt is internal and
  co-located in `synthesis-prompt.ts`. Tuning lands as a focused
  follow-up, not as a per-call parameter.
- No cost surfacing into autonomy. The module uses the project's
  configured model client; cost dashboards stay where they already
  live. The history store records what the typed envelope already
  contains; it does not surface per-call token usage or cost.
- No second persistence path. The store is the only on-disk record of
  cited-answer envelopes — no parallel logging, no second envelope
  shape elsewhere.
- No fan-out from this module. Surface adoption (Telegram, macOS,
  mobile, web) ships as honest single-task follow-ups, not a parallel
  five-surface chain seeded here.
