---
id: task-persist-cited-answer-envelopes-as-a-typed-answer-h
title: Persist cited-answer envelopes as a typed answer-history store with a read surface
status: done
priority: p2
area: modules
summary: Extend the answer module to persist every AnswerProvider.answer envelope (ok and ok=false alike) as a typed record under .kota/answer-history/, and expose one read seam (KotaClient.answer.log/show + kota answer log/show CLI + daemon route) so operators can re-read past synthesized answers and the eval-harness has a real-failure corpus to draw from.
created_at: 2026-04-28T00:14:09.380Z
updated_at: 2026-04-28T00:44:25.447Z
---

## Problem

The cited-answer seam (`src/modules/answer/`, commit `082c565f`) has now
fanned out across every registered operator surface — Telegram
(`82a544af`), web `AnswerPanel` (`1d3dcefb`), macOS `DaemonClient.answer`
+ `AnswerView` (`647ddb85` + `70308aab`), and mobile `AnswerScreen`
(`307a0b61`) — closing the "ask one question, get one synthesized
answer with typed citations" capability across CLI, daemon, and four
clients. But the seam still throws every answer envelope away as soon
as it returns. There is no on-disk record of what the operator asked,
what hits the recall step returned, what answer the synthesizer
composed, which citations resolved, or how often the seam degraded to
`no_hits` / `semantic_unavailable` / `synthesis_failed`.

That gap matters in two concrete ways:

- **Operator-side**: an operator on any surface can ask a question
  once, but cannot scroll back to "what did I ask three days ago?" or
  re-render a past synthesized answer. The personal-assistant
  experience is amnesiac for the synthesis layer specifically — chat
  history captures conversational sessions, but one-shot
  `kota answer` / `/answer` / `AnswerPanel` / `AnswerView` /
  `AnswerScreen` calls leave no trail.
- **Eval-side**: `src/modules/eval-harness/AGENTS.md` requires every
  shipped fixture to encode a real past failure (`Fixture Provenance`)
  and the autonomy `AGENTS.md` makes the same rule load-bearing
  ("Eval fixtures come from real failures. Seed `eval-harness` from
  `.kota/runs/`, not synthetic."). Today the answer module produces
  zero corpus for that rule — every degraded envelope is unobservable
  after the call returns. The first time an operator hits a
  `synthesis_failed` arm in production there is nothing for the
  eval-harness to pull from.

The fix is the typed-store mirror of what `.kota/runs/` already does
for workflow runs: every `AnswerProvider.answer(...)` invocation
appends one typed record to a per-project on-disk store, with a small
read seam so the operator (and, later, the eval-harness) can read
those records back without parsing log lines.

## Desired Outcome

- The answer module owns a new typed `AnswerHistoryStore` primitive.
  The store persists one record per `AnswerProvider.answer(query, filters?)`
  call, regardless of `ok`, with the typed shape:
  - `id` — sortable id (e.g. `<ISO-timestamp>-<short-random>`) matching
    the `.kota/runs/` naming style so operators recognize it.
  - `createdAt` — ISO timestamp.
  - `query` — the original query string verbatim.
  - `filters` — the typed `AnswerFilter` actually used (post-default).
  - `recallHits` — the typed `RecallHit[]` the synthesizer was shown
    (the same hit list the response would have surfaced; for `ok: false`
    arms that never reached the synthesizer, the field reflects what
    recall returned).
  - `result` — the discriminated `AnswerResult` envelope returned to
    the caller (`ok: true` with `answer` + `citations`, or
    `ok: false` with `reason`).
- Persistence is wired into the existing `AnswerProviderImpl` through
  one new typed `AnswerHistorySink` dependency injected at construction
  time, so unit tests can substitute an in-memory recorder without
  monkey-patching. The disk-backed implementation lives in the answer
  module, not in `src/core/`.
- The store gains:
  - `appendAnswer(record): Promise<void>` — called from the provider
    after every envelope, success or failure. A failing append surfaces
    as a logged warning (using the existing module-context warn channel)
    and does not change the operator-visible response — the answer
    envelope is still returned exactly as it is today.
  - `listAnswers({ limit, beforeId? }): Promise<AnswerHistoryEntry[]>` —
    newest-first paginated list, returning a small projection
    (`id`, `createdAt`, `query`, `result.ok`, `result.reason?`,
    `result.citations.length` when `ok: true`) suitable for a one-line
    operator render per row.
  - `getAnswer(id): Promise<AnswerHistoryRecord | null>` — full record
    by id, including the original `recallHits` and `citations`.
- Two new operator-readable surfaces:
  - `kota answer log [--limit N] [--before <id>] [--json]` — newest-first
    listing rendered through `src/modules/rendering`. Prints one row per
    entry: timestamp, ok/reason badge, citation count, and a truncated
    query. `--json` returns the typed projection.
  - `kota answer show <id> [--json]` — full record render reusing the
    same rendering helper as `kota answer <query>` so the body, inline
    `[source:id]` markers, and per-citation list look identical to the
    live render. `--json` returns the typed full record.
- Two new daemon HTTP routes mirroring the existing `POST /api/answer`
  pattern:
  - `GET /api/answers` (list, query string mirrors the CLI flags) and
    `GET /answers` daemon-control twin.
  - `GET /api/answers/:id` (detail) and `GET /answers/:id`
    daemon-control twin.
  Both routes share one `createAnswerHistoryRouteHandler` so the wire
  shape cannot drift between user-facing and control surfaces, matching
  how `createAnswerRouteHandler` already works.
- `KotaClient.answer` gains `log(options?)` and `show(id)` returning the
  typed projection / record shapes, reachable through the existing
  daemon-up + daemon-down composer (`localClient(ctx)` plus the daemon
  link), with strict envelope decoding and loud rejection of unknown
  shapes — same discipline the existing `answer.answer(...)` namespace
  uses.
- Storage layout lives under the project root's KOTA state root —
  `<projectStateRoot>/answer-history/<id>.json` — one record per file,
  matching the `.kota/runs/` pattern. Reads are streamed, not loaded
  into memory all at once.
- A bounded retention policy keeps the store from growing without
  limit: the store prunes oldest entries past a configurable cap
  (default ~1000 records) on append. Pruning is best-effort and never
  blocks the answer response. The cap is module-internal, not exposed
  on the `answer` namespace as a runtime knob.
- Surface fan-out (Telegram, web `AnswerPanel`, macOS `AnswerView`,
  mobile `AnswerScreen`) is intentionally out of scope here. Those
  ship later as honest single-task follow-ups, not a parallel
  five-surface chain seeded all at once — the same discipline the
  cited-answer seam itself followed.

## Constraints

- **One mechanism.** The store is the single persistence layer for
  cited-answer envelopes. Do not add a parallel logging path, a
  parallel rendering helper, or a second envelope shape elsewhere.
- **Module-first.** All new code (store, sink, routes, CLI subcommands,
  KotaClient namespace methods) lives under `src/modules/answer/`. No
  spillover into `src/core/`. Follow the existing `src/modules/answer/`
  file-size discipline; split files if any individual file would
  exceed ~300 lines.
- **Strict typed protocols.** `AnswerHistoryRecord`, `AnswerHistoryEntry`,
  and the list/show envelopes are strict — no nullable fields admitted
  for "absent reason" when `ok: true`; use the existing discriminated
  `AnswerResult` shape. `recallHits` keeps the typed `RecallHit`
  discriminated union from `src/modules/recall/`. No free-form
  `Record<string, unknown>` payloads.
- **Append never fails the answer call.** A persistence error must not
  alter the operator-visible response or cost an extra retry of the
  synthesizer. Surface the failure through a logged warning, not by
  swallowing or re-throwing into the caller.
- **No cost surfacing into autonomy.** The store records what the
  envelope already contains; do not add per-call token-usage,
  cost-in-dollars, or model-id fields that would feed cost signals
  back into agent-facing context. (Standing autonomy rule.)
- **No backwards-compat shim.** The store launches as the only answer
  persistence path; no opt-in flag, no "legacy unrecorded" mode, no
  parallel namespace. The existing `KotaClient.answer.answer(...)`
  shape stays exactly as today.
- **Retention is module-internal.** Pruning runs inside the store, not
  through a new workflow or operator surface. Operators wanting larger
  retention adjust the cap in code; expose no daemon route or CLI
  flag for it in this task.
- **Use the existing rendering layer.** `kota answer log` /
  `kota answer show` route through `src/modules/rendering`; do not
  print raw ANSI, and do not bypass the existing render helper used
  by `kota answer <query>`.
- **No fan-out from this task.** Telegram, web, macOS, and mobile
  surfaces stay out of scope. The seam ships, surfaces follow as
  separate tasks if and when operators ask.
- **No eval-harness fixture authoring in this task.** The store is the
  corpus; turning recorded envelopes into eval-harness fixtures is its
  own follow-up that the eval-harness module owns. Do not pre-emptively
  contribute fixtures from this task.

## Done When

- `src/modules/answer/answer-history-store.ts` (or equivalent file
  layout) defines the typed `AnswerHistoryRecord`,
  `AnswerHistoryEntry`, `AnswerHistorySink`, and `AnswerHistoryStore`
  shapes plus the disk-backed implementation rooted at the project's
  KOTA state root.
- `AnswerProviderImpl` accepts the sink as a typed dependency and
  appends one record per `answer(query, filters?)` call. Existing
  `answer-provider.test.ts` is updated (or paired with a focused new
  test) to cover the append-on-success, append-on-no_hits,
  append-on-semantic_unavailable, append-on-synthesis_failed paths,
  and the "append failure does not change the operator response"
  invariant.
- `kota answer log` and `kota answer show <id>` exist in
  `src/modules/answer/cli.ts`, render through
  `src/modules/rendering`, support `--json`, and have CLI tests in
  `src/modules/answer/cli.test.ts` covering: empty store, one-record
  list (success), mixed ok/ok=false rows, `show` of an `ok: true`
  record (body + citations), and `show` of an `ok: false` record
  (reason rendered, no synthesized body).
- Daemon HTTP routes `GET /api/answers`, `GET /api/answers/:id` and
  their `GET /answers`, `GET /answers/:id` control twins exist via one
  shared `createAnswerHistoryRouteHandler`, with route tests in
  `src/modules/answer/routes.test.ts` covering list pagination,
  `show` for both ok arms, and `show` returning a typed `null` /
  not-found envelope for an unknown id.
- `KotaClient.answer.log(options?)` and `KotaClient.answer.show(id)`
  exist in the answer namespace, reach the daemon route from the
  daemon-link path and the local provider from the daemon-down path,
  reject malformed wire shapes loudly, and are covered in the
  existing answer namespace tests.
- A representative real run exists under
  `<projectStateRoot>/answer-history/` after a hand-run of
  `kota answer "<query>"` against this repo, demonstrating that the
  store is wired live (not just unit-tested in isolation). The captured
  CLI transcript under the run directory shows the live answer
  followed by `kota answer log --limit 5` listing that record alongside
  any other records produced during the run, plus
  `kota answer show <id>` re-rendering the stored record verbatim.
- Retention prunes oldest entries past the cap; the prune path is
  unit-tested with a small cap (e.g. cap=3, append 5 records, observe
  oldest 2 dropped) so the behavior cannot silently regress.
- `src/modules/answer/AGENTS.md` gains a short section describing the
  store: what it persists, the retention contract, and the rule that
  append failures never alter the answer response. No per-file
  inventory.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-27T22-05-53-548Z-explorer-i2n76g/` after the mobile
`AnswerScreen` (commit `307a0b61`) closed the cited-answer fan-out
across CLI, daemon, Telegram, web, macOS, and mobile. Inspecting
`src/modules/answer/answer-provider.ts` shows the `AnswerProviderImpl`
returns the typed envelope to the caller and never persists it. The
"second brain" framing in the cited-answer seam's own `Initiative`
("KOTA should answer one operator query with one short composed answer
plus typed citations into the second brain") implies the answer is
also part of the brain — but today the synthesis layer specifically is
amnesiac. Closing that gap is the highest-leverage next move on the
personal-assistant trajectory that does not seed another six-surface
fan-out chain. The eval-harness corpus argument is reinforced by
`src/modules/eval-harness/AGENTS.md` (`Fixture Provenance`) and the
autonomy `AGENTS.md` rule "Eval fixtures come from real failures.
Seed `eval-harness` from `.kota/runs/`, not synthetic."

## Initiative

Personal-assistant answering — durable. KOTA should not just answer
the operator's question once but remember the answer alongside the
typed citations, so the operator can re-read it later and the
eval-harness can pull real-failure provenance from the same corpus
the operator already produces by using the assistant. This task lands
the typed seam plus the minimal CLI + daemon read surface. Surface
fan-out (Telegram, web, macOS, mobile) and eval-harness fixture
authoring land as separate honest follow-ups when there is a real
operator or harness pull for them.

## Acceptance Evidence

- Diff covering the new typed `AnswerHistoryStore` /
  `AnswerHistoryRecord` shapes, the disk-backed implementation, the
  `AnswerProviderImpl` wiring, the new CLI subcommands, the new daemon
  routes, and the `KotaClient.answer.log` / `show` namespace methods.
- Unit tests proving append-on-every-arm, append-failure-isolation,
  retention pruning, list pagination, and show-by-id (including
  not-found) — running through `pnpm test`.
- A captured CLI transcript under the run directory showing
  (a) `kota answer "<query>"` returning a normal cited answer,
  (b) `kota answer log --limit 5` listing that answer with timestamp,
  ok badge, citation count, and truncated query,
  (c) `kota answer show <id>` re-rendering the same body and
  citations as the original `kota answer <query>` produced,
  (d) `kota answer log --json` and `kota answer show <id> --json`
  showing the typed projection / record envelopes.
- A short HTTP transcript (curl or kota-client invocation) showing
  the daemon routes returning the same typed envelopes as the CLI for
  the same record id.
- The updated `src/modules/answer/AGENTS.md` describing the store
  contract.
