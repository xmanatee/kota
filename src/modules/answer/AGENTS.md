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
- The answer route resolves a concrete project id before synthesis. The
  provider persists through the project-scoped answer-history store and
  forwards the same project id through recall.
- One `KotaClient.answer` namespace and one `kota answer <query>` CLI
  subcommand rendered through `src/modules/rendering`.
- One agent-callable tool (`answer`) through `KotaModule.tools`; it uses
  the same `AnswerProvider`, `renderAnswerReplyPlain`, recall,
  synthesizer, and answer-history path as every other surface.
- One per-turn dynamic system-prompt contributor
  (`buildAnswerDynamicStateProvider`, registered during `onLoad`). It
  emits guidance only when the effective tool policy admits `answer`,
  steering fact-shaped turns through cited answers and answer history.

## Typed citation contract

The synthesizer emits `[source:id]` markers in the prose where
`source ∈ {knowledge, memory, history, tasks, answer}` (matching
`RecallSource` exactly; no aliases) and `id` is the typed hit id. The
`answer` arm covers synthesizer chaining through a prior cited-answer
envelope when recall surfaced one. The parser extracts each marker,
validates it against the typed
`RecallHit[]` the synthesizer was shown, and returns:

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
keeping path for cited-answer envelopes, the corpus seam the
eval-harness pulls real-failure provenance from, and the data source
behind the `answer` recall contributor below. Reads exposed as
`KotaClient.answer.log` / `show`, `kota answer log` / `show`, and
`GET /api/answers` + `GET /api/answers/:id` (with `/answers` daemon-
control twins).

Contracts:

- One record per call regardless of the discriminated `AnswerResult`
  arm. Success records carry the typed `RecallHit[]` the synthesizer
  was shown plus the typed `[source:id]` citations; failure records
  carry the recall hits the seam saw (or an empty array for arms that
  never reached recall).
- An append failure never alters the operator-visible response. The
  `onPersistError` callback surfaces the error through the module's
  warn channel and the answer envelope is still returned as computed.
- Retention is module-internal: the store best-effort prunes oldest
  entries past `ANSWER_HISTORY_DEFAULT_CAP` on append. No operator knob.

## Recall contribution

The answer module owns its recall adapter end-to-end.
`recall-contributor.ts` wraps `AnswerHistoryStore.searchAnswers` into a
`RecallContributor` for the `answer` source; the module registers it
from its own `onLoad` against the live `RecallProvider` (looked up
through `ctx.getProvider(RECALL_PROVIDER_TOKEN)` — the same typed
registry seam every other cross-module provider access uses) and
`onUnload` calls `recallProvider.unregister("answer")`. The recall
module does not import answer code; registration flows one-way
through the public `RecallProvider` API.

`searchAnswers` is keyword-shaped: it scans the newest-first id
listing, decodes records lazily, and ranks by token overlap against
the stored `query` (and synthesized text on `ok: true`). Native scores
fall in `[0, 1]`, matching the recall module's keyword-fallback
contract.

## Tests

- Unit tests sit beside the code and cover provider, history store,
  citation parser, recall contributor, routes, CLI, tool, dynamic prompt,
  and lifecycle behavior.
- Integration anchors live in
  `src/conversational-agent-tools.integration.test.ts` for tool
  end-to-end behavior, prior-answer recall, answer chaining, and
  post-retract settling; `src/conversational-prompt-priming.integration.test.ts`
  pins the answer block's dynamic-state admission gate.

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
- Project-scoped reads and writes use `AnswerProjectContext`; the default
  history store is only the fallback for the default project.
- No fan-out from this module. Surface adoption ships as honest
  single-task follow-ups owned by the surface module, not a parallel
  multi-surface chain seeded here.
